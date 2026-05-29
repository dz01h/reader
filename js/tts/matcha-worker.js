importScripts('https://cdn.jsdelivr.net/npm/pinyin-pro@3.24.2/dist/index.js');
importScripts('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/ort.min.js');

ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/';
// Disable multi-threading in ORT to ensure it doesn't need SharedArrayBuffer
ort.env.wasm.numThreads = 1;

// ISTFT configuration for Vocos
const n_fft = 1024;
const hop_length = 256;
const win_length = 1024;

// Precompute periodic Hann window
const hannWindow = new Float32Array(win_length);
for (let i = 0; i < win_length; i++) {
    hannWindow[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / win_length);
}

function bitReverse(n, bits) {
    let reversed = 0;
    for (let i = 0; i < bits; i++) {
        reversed = (reversed << 1) | (n & 1);
        n >>= 1;
    }
    return reversed;
}

function fft(real, imag) {
    const n = real.length;
    const bits = Math.log2(n);

    for (let i = 0; i < n; i++) {
        const j = bitReverse(i, bits);
        if (i < j) {
            let temp = real[i]; real[i] = real[j]; real[j] = temp;
            temp = imag[i]; imag[i] = imag[j]; imag[j] = temp;
        }
    }

    for (let len = 2; len <= n; len <<= 1) {
        const halfLen = len >> 1;
        const angle = -2 * Math.PI / len;
        const wReal = Math.cos(angle);
        const wImag = Math.sin(angle);

        for (let i = 0; i < n; i += len) {
            let uReal = 1;
            let uImag = 0;

            for (let j = 0; j < halfLen; j++) {
                const u = i + j;
                const v = i + j + halfLen;

                const tReal = uReal * real[v] - uImag * imag[v];
                const tImag = uReal * imag[v] + uImag * real[v];

                real[v] = real[u] - tReal;
                imag[v] = imag[u] - tImag;
                real[u] += tReal;
                imag[u] += tImag;

                const nextUReal = uReal * wReal - uImag * wImag;
                uImag = uReal * wImag + uImag * wReal;
                uReal = nextUReal;
            }
        }
    }
}

function ifft(real, imag) {
    const n = real.length;
    for (let i = 0; i < n; i++) imag[i] = -imag[i];
    fft(real, imag);
    for (let i = 0; i < n; i++) {
        real[i] /= n;
        imag[i] = -imag[i] / n;
    }
}

function computeISTFT(mag, x, y, num_frames) {
    const n_freqs = n_fft / 2 + 1; // 513
    const expected_length = (num_frames - 1) * hop_length + win_length;
    const output = new Float32Array(expected_length);
    const window_sum = new Float32Array(expected_length);

    const frame_real = new Float32Array(n_fft);
    const frame_imag = new Float32Array(n_fft);

    for (let i = 0; i < num_frames; i++) {
        frame_real.fill(0);
        frame_imag.fill(0);

        for (let k = 0; k < n_freqs; k++) {
            const idx = k * num_frames + i;
            const m = mag[idx];
            const real_part = m * x[idx];
            const imag_part = m * y[idx];

            frame_real[k] = real_part;
            frame_imag[k] = imag_part;

            if (k > 0 && k < n_freqs - 1) {
                frame_real[n_fft - k] = real_part;
                frame_imag[n_fft - k] = -imag_part;
            }
        }

        ifft(frame_real, frame_imag);

        const offset = i * hop_length;
        for (let j = 0; j < win_length; j++) {
            const out_idx = offset + j;
            output[out_idx] += frame_real[j] * hannWindow[j];
            window_sum[out_idx] += hannWindow[j] * hannWindow[j];
        }
    }

    for (let i = 0; i < expected_length; i++) {
        if (window_sum[i] > 1e-7) {
            output[i] /= window_sum[i];
        }
    }

    const pad = n_fft / 2;
    return output.slice(pad, output.length - pad);
}

let acousticSession = null;
let vocoderSession = null;
let tokensMap = new Map();
let sampleRate = 22050; // Default, will try to infer or hardcode if needed

onmessage = async function(e) {
    const data = e.data;
    if (data.type === 'INIT') {
        try {
            await initModels(data.modelConfig);
        } catch (err) {
            console.error('[MatchaWorker] Init error:', err);
            postMessage({ type: 'ERROR', text: '', error: err.toString() });
        }
    } else if (data.type === 'SYNTHESIZE') {
        try {
            await synthesize(data.text, data.sid, data.speed);
        } catch (err) {
            console.error('[MatchaWorker] Synthesize error:', err);
            postMessage({ type: 'ERROR', text: data.text, error: err.toString() });
        }
    }
};

async function initModels(modelConfig) {
    postMessage({ type: 'INIT_PROGRESS', message: '下載並載入發音字典...' });

    const tokensText = await fetch(modelConfig.files.tokens).then(r => r.text());
    const lines = tokensText.split('\n');
    tokensMap.clear();
    for (const line of lines) {
        if (!line.trim()) continue;
        const lastSpace = line.lastIndexOf(' ');
        if (lastSpace !== -1) {
            const token = line.substring(0, lastSpace).trim();
            const id = parseInt(line.substring(lastSpace + 1).trim(), 10);
            tokensMap.set(token, id);
        }
    }

    postMessage({ type: 'INIT_PROGRESS', message: '載入聲學模型 (Acoustic)...' });
    acousticSession = await ort.InferenceSession.create(modelConfig.files.acousticModel, {
        executionProviders: ['wasm']
    });

    postMessage({ type: 'INIT_PROGRESS', message: '載入聲碼器 (Vocoder)...' });
    vocoderSession = await ort.InferenceSession.create(modelConfig.files.vocoder, {
        executionProviders: ['wasm']
    });

    // 根據模型判斷 sampleRate
    if (modelConfig.files.vocoder.includes('16khz')) {
        sampleRate = 16000;
    } else if (modelConfig.files.vocoder.includes('22khz') || modelConfig.files.vocoder.includes('24khz')) {
        sampleRate = 22050;
    }

    postMessage({ type: 'READY' });
}

function textToTokens(text) {
    const pinyinArray = pinyinPro.pinyin(text, { toneType: 'num', type: 'array', nonZh: 'consecutive' })
        .map(py => py.replace(/0$/, '5')); // map light tone 0 to 5
    const ids = []; // No padding required for this specific model architecture in JS


    for (const py of pinyinArray) {
        if (tokensMap.has(py)) {
            ids.push(tokensMap.get(py));
        } else if (tokensMap.has(py.toLowerCase())) {
            ids.push(tokensMap.get(py.toLowerCase()));
        } else {
            // 將未知的字串拆成單個字元去對應
            for (const char of py) {
                if (tokensMap.has(char)) {
                    ids.push(tokensMap.get(char));
                } else {
                    console.warn(`[MatchaWorker] Token not found for: ${char}`);
                }
            }
        }
    }

    // console.log('[MatchaWorker] Text:', text);
    // console.log('[MatchaWorker] Pinyin Array:', pinyinArray);
    // console.log('[MatchaWorker] Mapped IDs:', ids);

    return ids;
}

async function synthesize(text, sid, speed) {
    const tokenIds = textToTokens(text);
    if (tokenIds.length === 0) {
        throw new Error("No tokens generated for text: " + text);
    }

    const length = tokenIds.length;
    const xData = BigInt64Array.from(tokenIds.map(BigInt));
    const x = new ort.Tensor('int64', xData, [1, length]);
    const x_lengths = new ort.Tensor('int64', BigInt64Array.from([BigInt(length)]), [1]);

    const noise_scale = new ort.Tensor('float32', new Float32Array([0.667]), [1]);
    const length_scale = new ort.Tensor('float32', new Float32Array([1.0 / speed]), [1]);
    const noise_scale_w = new ort.Tensor('float32', new Float32Array([0.8]), [1]);

    const feeds = {};
    for (const inputName of acousticSession.inputNames) {
        if (inputName === 'x') feeds[inputName] = x;
        else if (inputName === 'x_lengths' || inputName === 'x_length') feeds[inputName] = x_lengths;
        else if (inputName === 'scales') feeds[inputName] = new ort.Tensor('float32', new Float32Array([0.667, 1.0/speed, 0.8]), [3]);
        else if (inputName === 'noise_scale') feeds[inputName] = noise_scale;
        else if (inputName === 'length_scale') feeds[inputName] = length_scale;
        else if (inputName === 'noise_scale_w') feeds[inputName] = noise_scale_w;
        else if (inputName === 'sid') feeds[inputName] = new ort.Tensor('int64', BigInt64Array.from([BigInt(sid)]), [1]);
    }

    const acousticOutput = await acousticSession.run(feeds);

    let melTensor = null;
    for (const outName of acousticSession.outputNames) {
         melTensor = acousticOutput[outName];
         break;
    }

    if (!melTensor) throw new Error("Acoustic model failed to produce output");

    const vocoderFeeds = {};
    for (const inputName of vocoderSession.inputNames) {
        vocoderFeeds[inputName] = melTensor;
        break;
    }

    const vocoderOutput = await vocoderSession.run(vocoderFeeds);

    let audioSamples;

    // Check if output is STFT components (Vocos)
    if (vocoderOutput['mag'] && vocoderOutput['x'] && vocoderOutput['y']) {
        const mag = vocoderOutput['mag'];
        const x = vocoderOutput['x'];
        const y = vocoderOutput['y'];
        const num_frames = mag.dims[2]; // shape is [1, 513, frames]

        audioSamples = computeISTFT(mag.data, x.data, y.data, num_frames);
    } else if (vocoderOutput['y']) {
        // Fallback for standard HiFi-GAN
        audioSamples = vocoderOutput['y'].data;
    } else if (vocoderOutput['audio']) {
        audioSamples = vocoderOutput['audio'].data;
    } else {
        const keys = Object.keys(vocoderOutput);
        audioSamples = vocoderOutput[keys[keys.length - 1]].data;
    }

    postMessage({
        type: 'DONE',
        text: text,
        samples: audioSamples,
        sampleRate: sampleRate
    });
}
