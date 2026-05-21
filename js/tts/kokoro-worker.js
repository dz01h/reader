let tts = null;

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

self.onmessage = async (e) => {
    const { type, text, voice, requestId } = e.data;

    if (type === 'INIT') {
        try {
            console.log("[Kokoro Worker] Loading kokoro-js...");
            const { KokoroTTS } = await import('https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm');

            let device = "wasm";
            let dtype = "q8";

            // WebGPU detection and initialization with automatic fallback to WASM
            if (typeof navigator !== 'undefined' && navigator.gpu) {
                try {
                    console.log(`[Kokoro Worker] WebGPU detected. Attempting WebGPU initialization (${MODEL_ID}, fp32)...`);
                    tts = await KokoroTTS.from_pretrained(MODEL_ID, {
                        dtype: "fp32",
                        device: "webgpu"
                    });
                    device = "webgpu";
                    dtype = "fp32";
                    console.log("[Kokoro Worker] WebGPU initialization successful!");
                } catch (webgpuError) {
                    console.warn("[Kokoro Worker] WebGPU initialization failed, falling back to WASM/CPU:", webgpuError);
                    tts = null;
                }
            }

            if (!tts) {
                console.log(`[Kokoro Worker] Attempting WASM/CPU initialization (${MODEL_ID}, q8)...`);
                tts = await KokoroTTS.from_pretrained(MODEL_ID, {
                    dtype: "q8",
                    device: "wasm"
                });
                device = "wasm";
                dtype = "q8";
                console.log("[Kokoro Worker] WASM/CPU initialization successful!");
            }

            self.postMessage({ type: 'READY', device, dtype });
        } catch (err) {
            console.error("[Kokoro Worker] Initialization failed:", err);
            self.postMessage({ type: 'ERROR', message: err.message, step: 'init' });
        }
        return;
    }

    if (type === 'GENERATE') {
        if (!tts) {
            self.postMessage({ type: 'ERROR', message: 'Model not initialized', step: 'generate', text, requestId });
            return;
        }
        try {
            console.log(`[Kokoro Worker] Generating: "${text}" with voice "${voice}"`);
            const result = await tts.generate(text, { voice });
            // result is { audio: Float32Array, sampling_rate: number }
            const buffer = result.audio.buffer;
            const sampleRate = result.sampling_rate || result.sampleRate || 24000;
            self.postMessage({ 
                type: 'DONE', 
                text, 
                requestId, 
                audioBuffer: buffer, 
                sampleRate: sampleRate 
            }, [buffer]);
        } catch (err) {
            console.error("[Kokoro Worker] Generate error:", err);
            self.postMessage({ type: 'ERROR', message: err.message, step: 'generate', text, requestId });
        }
    }
};
