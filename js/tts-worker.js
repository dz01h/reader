import * as VITSWeb from 'https://cdn.jsdelivr.net/npm/@diffusionstudio/vits-web@1.0.3/+esm';
import * as OpenCC from 'https://cdn.jsdelivr.net/npm/opencc-js@1.0.5/+esm';
import { Mp3Encoder } from 'https://cdn.jsdelivr.net/npm/@breezystack/lamejs@1.2.7/+esm';

let converter = null;
let currentSessionId = 0;

self.onmessage = async (e) => {
    const { type, text, voiceId, index, sessionId } = e.data;

    console.log(`[worker]`, e.data);

    if (type === 'INIT') {
        converter = OpenCC.Converter({ from: 'tw', to: 'cn' });
        self.postMessage({ type: 'READY' });
        return;
    }
    if (type === 'SYNTHESIZE') {
        try {
            console.log(`[worker synth start]`, text);
            let input = converter(text);
            // input = input.replace(/([，、；：。])/g, '$1\n').trim();

            let st = Date.now();
            const wavBlob = await VITSWeb.predict({ text: input, voiceId: voiceId });
            const useTime = Date.now() - st;
            console.log(`[worker synth predict] ${useTime}ms (${useTime / input.length}ms/char)`, input);

            const arrayBuf = await wavBlob.arrayBuffer();

            self.postMessage({ type: 'DONE', index, sessionId, buffer: arrayBuf, text }, [arrayBuf]);












            const isJa = /[\u3040-\u309F\u30A0-\u30FF]/.test(text);
            const isZh = /[\u4e00-\u9fa5]/.test(text);
            const lang = isJa ? 'ja' : isZh ? 'zh-TW' : 'en';

            const modelMap = {
                'zh-TW': voiceId,
                'en': 'en_US-hfc_female-medium',
                'ja': 'ja_JP-jvnv-medium'
            };
            const modelId = modelMap[lang] || voiceId;

            // Split on strong punctuation (sentence endings) to insert
            // explicit PCM silence between sentences.
            // Commas/clauses stay inside each sentence for espeak-ng to handle.
            const sentences = text
                .split(/([\u3002\uff01\uff1f\n])/)   // 。！？\n
                .reduce((acc, part, i) => {
                    if (i % 2 === 0) { if (part.trim()) acc.push(part); }
                    else { if (acc.length > 0) acc[acc.length - 1] += part; else if (part.trim()) acc.push(part); }
                    return acc;
                }, [])
                .filter(s => s.trim().length > 0);

            const PAUSE_AFTER_SENTENCE = 0.42; // seconds of silence after each sentence
            const pcmParts = [];
            let commonSampleRate = 22050;

            const t0 = performance.now();
            console.log(`[worker synth start] #${index} ${sentences.length} sentences, ${text.length}chars`);

            for (const sentence of sentences) {
                let input = (lang === 'zh-TW' && converter) ? converter(sentence) : sentence;
                // Light preprocessing: space after weak punctuation only
                input = input.replace(/([，、；：。])/g, '$1\n').trim();

                const wavBlob = await VITSWeb.predict({ text: input, voiceId: modelId });
                if (sessionId !== undefined && sessionId !== self._sessionId) break; // session cancelled

                const arrayBuf = await wavBlob.arrayBuffer();
                const sampleRate = new DataView(arrayBuf).getUint32(24, true);
                commonSampleRate = sampleRate;

                const pcm16 = new Int16Array(arrayBuf, 44);
                pcmParts.push(new Int16Array(pcm16)); // copy

                // Append silence after each sentence
                const silenceSamples = Math.floor(sampleRate * PAUSE_AFTER_SENTENCE);
                pcmParts.push(new Int16Array(silenceSamples)); // zeros = silence
            }

            const t1 = performance.now();
            const ms = (t1 - t0).toFixed(0);
            const cps = (text.length / ((t1 - t0) / 1000)).toFixed(1);
            console.log(`[worker synth done]  #${index} ${ms}ms (${cps} chars/s)`);

            // Combine all PCM parts
            const totalLen = pcmParts.reduce((s, p) => s + p.length, 0);
            const combined = new Int16Array(totalLen);
            let offset = 0;
            for (const part of pcmParts) { combined.set(part, offset); offset += part.length; }

            // Encode combined PCM to MP3
            const encoder = new Mp3Encoder(1, commonSampleRate, 128);
            const mp3Parts = [];
            const chunkSize = 1152 * 16;
            for (let i = 0; i < combined.length; i += chunkSize) {
                const buf = encoder.encodeBuffer(combined.subarray(i, i + chunkSize));
                if (buf.length > 0) mp3Parts.push(new Uint8Array(buf));
            }
            const remainder = combined.length % 1152;
            if (remainder !== 0) {
                const pad = new Int16Array(1152 - remainder);
                const padBuf = encoder.encodeBuffer(pad);
                if (padBuf.length > 0) mp3Parts.push(new Uint8Array(padBuf));
            }

            const mp3Total = mp3Parts.reduce((s, b) => s + b.length, 0);
            const mp3Combined = new Uint8Array(mp3Total);
            let mp3Offset = 0;
            for (const p of mp3Parts) { mp3Combined.set(p, mp3Offset); mp3Offset += p.length; }

            self.postMessage({ type: 'DONE', index, sessionId, buffer: mp3Combined, text }, [mp3Combined.buffer]);
        } catch (err) {
            console.error('Worker SYNTHESIZE error:', err);
            self.postMessage({ type: 'ERROR', index, sessionId, error: err.message, text });
        }
    }
};
