/**
 * sherpa-worker.js — sherpa-onnx WASM TTS Web Worker
 *
 * 協定：
 *   INIT   { modelConfig }              → READY | ERROR
 *   SYNTHESIZE { text, sid, speed, sessionId, text } → DONE { samples (Float32Array), sampleRate, text, sessionId }
 *                                                      | ERROR { error, text, sessionId }
 */

let tts = null;
let sampleRate = 22050;

// ─────────────────────────────────────────────
// sherpa-onnx WASM 模組動態載入
// ─────────────────────────────────────────────

/**
 * 從 GitHub Releases 取得 sherpa-onnx WASM glue JS 的穩定版本
 * 注意：WASM glue JS 會 importScripts 同目錄下的 .wasm，所以必須同源或 CORS 允許
 *
 * 策略：先嘗試從 Cache API 讀（已快取），否則從 GitHub Releases fetch 後存入 Cache
 */
const SHERPA_TTS_WRAPPER_URL = '../../lib/sherpa-onnx/sherpa-onnx-tts.js';
const SHERPA_WASM_JS_URL = '../../lib/sherpa-onnx/sherpa-onnx-wasm-main-tts.js';
const SHERPA_WASM_BIN_URL = '../../lib/sherpa-onnx/sherpa-onnx-wasm-main-tts.wasm';
const SHERPA_WASM_DATA_URL = '../../lib/sherpa-onnx/sherpa-onnx-wasm-main-tts.data';

async function loadSherpaOnnxModule() {
    // sherpa-onnx WASM 使用 Emscripten，必須透過 importScripts 載入 glue JS
    // 但 Worker 裡的 importScripts 只能同步，無法先等待快取邏輯
    // 所以改用動態 fetch + eval 的方式處理，或直接使用 importScripts 搭配可信的 CDN

    // 注意：GitHub Releases 支援 CORS，可以直接 importScripts
    // 但 .wasm 需要 locateFile 回調正確指向
    return new Promise((resolve, reject) => {
        try {
            importScripts(SHERPA_TTS_WRAPPER_URL, SHERPA_WASM_JS_URL);

            // 在 v1.13.2 中，Module 被編譯成一個 async function，需手動呼叫
            Module({
                mainScriptUrlOrBlob: SHERPA_WASM_JS_URL,
                locateFile: (filename) => {
                    if (filename.endsWith('.wasm')) return SHERPA_WASM_BIN_URL;
                    if (filename.endsWith('.data')) return SHERPA_WASM_DATA_URL;
                    return filename;
                },
                print: (text) => { console.log('[Sherpa C++] ' + text); },
                printErr: (text) => { console.error('[Sherpa C++ Err] ' + text); }
            }).then(m => {
                self.Module = m;
                resolve();
            }).catch(reject);

            setTimeout(() => {
                reject(new Error('sherpa-onnx WASM 模組載入逾時（15s）'));
            }, 15000);
        } catch (err) {
            reject(err);
        }
    });
}

// ─────────────────────────────────────────────
// 模型初始化
// ─────────────────────────────────────────────

/**
 * 從 URL fetch 模型檔並掛載到 Emscripten 虛擬 FS
 * @param {string} url
 * @param {string} vfsPath  在 Emscripten FS 中的路徑，例如 '/model/model.onnx'
 */
async function fetchAndMountFile(url, vfsPath) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`無法下載 ${url}: HTTP ${resp.status}`);
    const buf = await resp.arrayBuffer();
    const data = new Uint8Array(buf);

    // 如果路徑中有子資料夾，遞迴建立
    const parts = vfsPath.split('/');
    const name = parts.pop();
    const dir = parts.join('/') || '/';

    // 確保目錄存在
    try { Module.FS_createPath('/', dir.substring(1), true, true); } catch (e) {}
    Module.FS_createDataFile(dir, name, data, true, true, true);
    return vfsPath;
}

async function initTts(modelConfig) {
    self.postMessage({ type: 'INIT_PROGRESS', message: '正在載入 sherpa-onnx WASM 模組...' });
    await loadSherpaOnnxModule();

    self.postMessage({ type: 'INIT_PROGRESS', message: '正在下載語音引擎所需資源檔...' });

    // 下載所需檔案到虛擬檔案系統
    const { engine, files } = modelConfig;
    const { tokens, lexicon, ruleFsts = [], dictDir = [], dataFiles = [] } = files;

    const tokensVfsPath = await fetchAndMountFile(tokens, `/model/${tokens.split('/').pop()}`);

    if (dataFiles.length > 0) {
        await Promise.all(dataFiles.map(url => fetchAndMountFile(url, `/model/${url.split('/').pop()}`)));
    }

    let lexiconVfsPath = '';
    if (lexicon) {
        if (lexicon.includes(',')) {
            const urls = lexicon.split(',');
            const paths = await Promise.all(urls.map(u => fetchAndMountFile(u, `/model/${u.split('/').pop()}`)));
            lexiconVfsPath = paths.join(',');
        } else {
            lexiconVfsPath = await fetchAndMountFile(lexicon, '/model/lexicon.txt');
        }
    }

    let dictVfsPath = '';
    if (dictDir.length > 0) {
        await Promise.all(dictDir.map(url => fetchAndMountFile(url, `/model/dict/${url.split('/').pop()}`)));
        dictVfsPath = '/model/dict';
    }

    let ruleFstsPathStr = '';
    if (ruleFsts.length > 0) {
        const fstPaths = await Promise.all(ruleFsts.map(url => fetchAndMountFile(url, `/model/${url.split('/').pop()}`)));
        ruleFstsPathStr = fstPaths.join(',');
    }

    self.postMessage({ type: 'INIT_PROGRESS', message: '正在初始化 TTS 引擎...' });

    let offlineTtsModelConfig = {
        numThreads: 1,
        debug: 1,
        provider: 'cpu',
    };

    if (engine === 'vits') {
        const modelVfsPath = await fetchAndMountFile(files.model, '/model/model.onnx');
        offlineTtsModelConfig.offlineTtsVitsModelConfig = {
            model: modelVfsPath,
            lexicon: lexiconVfsPath,
            tokens: tokensVfsPath,
            dictDir: dictVfsPath,
        };
    } else if (engine === 'matcha') {
        const acousticModelPath = await fetchAndMountFile(files.acousticModel || files.model, '/model/acoustic_model.onnx');
        const vocoderPath = await fetchAndMountFile(files.vocoder, '/model/vocoder.onnx');
        offlineTtsModelConfig.offlineTtsMatchaModelConfig = {
            acousticModel: acousticModelPath,
            vocoder: vocoderPath,
            lexicon: lexiconVfsPath,
            tokens: tokensVfsPath,
            dictDir: dictVfsPath,
            dataDir: '/model',
            noiseScale: 0.667,
            lengthScale: 1
        };
    } else if (engine === 'kokoro') {
        const modelPath = await fetchAndMountFile(files.model, '/model/model.onnx');
        const voicesPath = await fetchAndMountFile(files.voices, '/model/voices.bin');
        offlineTtsModelConfig.offlineTtsKokoroModelConfig = {
            model: modelPath,
            voices: voicesPath,
            tokens: tokensVfsPath,
            lexicon: lexiconVfsPath,
            dataDir: "/model",
            lengthScale: 1
        };
    }

    // 建立 OfflineTts 設定
    const config = {
        offlineTtsModelConfig,
        maxNumSentences: 1,
        ruleFsts: ruleFstsPathStr,
        ruleFars: '',
    };

    tts = createOfflineTts(self.Module, config);
    if (!tts || !tts.handle) {
        throw new Error("createOfflineTts failed (handle is null). Check if model files are valid.");
    }

    sampleRate = tts.sampleRate;
}

// ─────────────────────────────────────────────
// 訊息處理
// ─────────────────────────────────────────────

self.onmessage = async (e) => {
    const { type, modelConfig, text, sid = 0, speed = 1.0, sessionId } = e.data;

    if (type === 'INIT') {
        try {
            await initTts(modelConfig);
            self.postMessage({ type: 'READY', sampleRate });
        } catch (err) {
            console.error('[SherpaWorker] INIT error:', err);
            self.postMessage({ type: 'ERROR', error: err.message, text: '' });
        }
        return;
    }

    if (type === 'SYNTHESIZE') {
        if (!tts) {
            self.postMessage({ type: 'ERROR', error: 'TTS 引擎尚未初始化', text, sessionId });
            return;
        }
        try {
            const st = Date.now();
            const result = tts.generate({ text, sid, speed });
            console.log(`[SherpaWorker] generate ${Date.now() - st}ms, ${result.samples.length} samples`);

            // result.samples 是 Float32Array，可直接 transfer
            const samples = result.samples;
            self.postMessage(
                { type: 'DONE', samples, sampleRate, text, sessionId },
                [samples.buffer]
            );
        } catch (err) {
            console.error('[SherpaWorker] SYNTHESIZE error:', err);
            self.postMessage({ type: 'ERROR', error: err.message, text, sessionId });
        }
        return;
    }
};
