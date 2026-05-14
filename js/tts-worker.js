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
        } catch (err) {
            console.error('Worker SYNTHESIZE error:', err);
            self.postMessage({ type: 'ERROR', index, sessionId, error: err.message, text });
        }
    }
};

