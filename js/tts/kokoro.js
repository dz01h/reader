class ZenTTSKokoro {
    constructor(app) {
        this.app = app;
        this.worker = null;
        this.audioCtx = null;
        this.compressor = null;
        this.nextStartTime = 0;
        this._scheduledSources = [];
        this._lastRawText = null;
        this.isManualSuspended = false;
        this.isLoading = false;
        this.initPromise = null;
        this._pendingRequests = new Map(); // requestId -> { resolve, reject }
        this._nextRequestId = 1;
        this._initResolver = null;
        this._initRejecter = null;
        
        this._setupAudioContext();
    }

    _setupAudioContext() {
        if (!this.audioCtx) {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            this.compressor = this.audioCtx.createDynamicsCompressor();
            this.compressor.threshold.setValueAtTime(-1.0, this.audioCtx.currentTime);
            this.compressor.knee.setValueAtTime(40, this.audioCtx.currentTime);
            this.compressor.ratio.setValueAtTime(12, this.audioCtx.currentTime);
            this.compressor.attack.setValueAtTime(0, this.audioCtx.currentTime);
            this.compressor.release.setValueAtTime(0.25, this.audioCtx.currentTime);
            this.compressor.connect(this.audioCtx.destination);
        }
    }

    async init() {
        if (this.worker) return;
        if (this.initPromise) return this.initPromise;

        this.initPromise = new Promise((resolve, reject) => {
            this.isLoading = true;
            this._initResolver = resolve;
            this._initRejecter = reject;

            document.body.dispatchEvent(new CustomEvent('ZenTTS:Status', { 
                detail: { status: 'loading', message: '正在載入 Kokoro AI 模型 (約 85MB)，請稍候...' } 
            }));

            try {
                console.log("[Kokoro] Spawning Web Worker...");
                this.worker = new Worker('js/tts/kokoro-worker.js', { type: 'module' });
                this.worker.onmessage = (e) => this._onWorkerMsg(e.data);
                this.worker.onerror = (err) => {
                    console.error("[Kokoro] Worker onerror:", err);
                    if (this._initRejecter) {
                        this._initRejecter(err);
                        this._initRejecter = null;
                        this._initResolver = null;
                    }
                    this.initPromise = null;
                    this.isLoading = false;
                };
                this.worker.postMessage({ type: 'INIT' });
            } catch (err) {
                console.error("[Kokoro] Worker spawn error:", err);
                reject(err);
                this.initPromise = null;
                this.isLoading = false;
            }
        });

        return this.initPromise;
    }

    _onWorkerMsg(data) {
        if (data.type === 'READY') {
            console.log(`[Kokoro] Worker and model ready! Running on ${data.device.toUpperCase()} (${data.dtype})`);
            document.body.dispatchEvent(new CustomEvent('ZenTTS:Status', { 
                detail: { status: 'ready' } 
            }));
            if (this._initResolver) {
                this._initResolver();
                this._initResolver = null;
                this._initRejecter = null;
            }
            this.isLoading = false;
            return;
        }

        if (data.type === 'ERROR' && data.step === 'init') {
            console.error("[Kokoro] Worker initialization failed:", data.message);
            document.body.dispatchEvent(new CustomEvent('ZenTTS:Status', { 
                detail: { status: 'error', message: data.message } 
            }));
            if (this._initRejecter) {
                this._initRejecter(new Error(data.message));
                this._initRejecter = null;
                this._initResolver = null;
            }
            this.initPromise = null;
            this.isLoading = false;
            if (this.worker) {
                try { this.worker.terminate(); } catch(e) {}
                this.worker = null;
            }
            return;
        }

        if (data.type === 'DONE') {
            const req = this._pendingRequests.get(data.requestId);
            if (req) {
                this._pendingRequests.delete(data.requestId);
                req.resolve({
                    audio: new Float32Array(data.audioBuffer),
                    sampleRate: data.sampleRate
                });
            }
        } else if (data.type === 'ERROR') {
            const req = this._pendingRequests.get(data.requestId);
            if (req) {
                this._pendingRequests.delete(data.requestId);
                req.reject(new Error(data.message));
            }
        }
    }

    _splitText(text) {
        if (!text) return [];
        return text.split(/[\n，。、；：！？－—…]+/)
            .map(s => s.replace(/\p{P}/gu, '').trim())
            .filter(s => s.length > 0);
    }

    prepare(readingData) {
        let text = readingData.reading;

        if (this._lastRawText && text && this._lastRawText !== text) {
            const maxOverlap = Math.min(this._lastRawText.length, text.length);
            for (let i = maxOverlap; i > 0; i--) {
                if (this._lastRawText.endsWith(text.substring(0, i))) {
                    text = text.substring(i);
                    break;
                }
            }
        }
        this._lastRawText = readingData.reading;

        let currentChunks = this._splitText(text);
        return new ZenTTSKokoroChunks(this, currentChunks);
    }

    async generateAudio(text) {
        await this.init();
        const voice = this.app.ttsVoice || 'af_heart';
        console.log(`[Kokoro] Requesting speech for text: "${text}" with voice: "${voice}"`);
        
        return new Promise((resolve, reject) => {
            const requestId = this._nextRequestId++;
            this._pendingRequests.set(requestId, { resolve, reject });
            this.worker.postMessage({
                type: 'GENERATE',
                text,
                voice,
                requestId
            });
        });
    }

    playFloat32Audio(float32Array, sampleRate) {
        if (this.audioCtx.state === 'suspended' && !this.isManualSuspended) {
            this.audioCtx.resume();
        }

        const activeSampleRate = sampleRate || 24000;
        const buffer = this.audioCtx.createBuffer(1, float32Array.length, activeSampleRate);
        buffer.copyToChannel(float32Array, 0);

        const source = this.audioCtx.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = this.app.ttsSpeed || 1.0;

        const gainNode = this.audioCtx.createGain();
        source.connect(gainNode);
        gainNode.connect(this.compressor);

        const now = this.audioCtx.currentTime;
        const start = Math.max(now, this.nextStartTime);
        const duration = buffer.duration / source.playbackRate.value;

        // Apply dynamic fade-in and fade-out to prevent audio clicks
        const fadeTime = 0.005;
        gainNode.gain.setValueAtTime(0, start);
        gainNode.gain.linearRampToValueAtTime(1, start + fadeTime);
        gainNode.gain.setValueAtTime(1, start + duration - fadeTime);
        gainNode.gain.linearRampToValueAtTime(0, start + duration);

        source.start(start);
        this.nextStartTime = start + duration;
        this._scheduledSources.push(source);

        source.onended = () => {
            this._scheduledSources = this._scheduledSources.filter(s => s !== source);
        };

        return source;
    }

    stopAudio(hardClear = true) {
        this._scheduledSources.forEach(s => {
            try { s.stop(); } catch (e) {}
            try { s.disconnect(); } catch (e) {}
        });
        this._scheduledSources = [];
        this.nextStartTime = 0;
        
        if (this.audioCtx && this.audioCtx.state === 'running') {
            this.audioCtx.suspend();
        }
        if (hardClear) {
            this._lastRawText = null;
        }
    }

    suspendAudio() {
        this.isManualSuspended = true;
        if (this.audioCtx && this.audioCtx.state === 'running') {
            this.audioCtx.suspend();
        }
    }

    resumeAudio() {
        this.isManualSuspended = false;
        if (this.audioCtx && this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }
    }

    destroy() {
        this.stopAudio(true);
        if (this.worker) {
            try { this.worker.terminate(); } catch (e) {}
            this.worker = null;
        }
        this.initPromise = null;
        this._pendingRequests.clear();
        if (this.audioCtx) {
            try { this.audioCtx.close(); } catch (e) {}
            this.audioCtx = null;
        }
    }
}

class ZenTTSKokoroChunks extends ZenTTSChunker {
    constructor(engine, chunks) {
        super('', null);
        this.engine = engine;
        this.chunks = chunks;
    }

    async speak() {
        const text = this.next();
        if (!text) return;

        // Notify controller to update MediaSession metadata
        document.body.dispatchEvent(new CustomEvent('ZenTTS:ChunkPlaying', { detail: { text } }));

        return new Promise(async (resolve) => {
            try {
                const audio = await this.engine.generateAudio(text);
                if (!audio || !audio.audio) {
                    resolve();
                    return;
                }

                const source = this.engine.playFloat32Audio(audio.audio, audio.sampleRate);
                const originalOnEnded = source.onended;
                
                source.onended = (e) => {
                    if (originalOnEnded) originalOnEnded(e);
                    // Add a natural pause between chunks (300ms)
                    setTimeout(() => resolve(), 300);
                };
            } catch (err) {
                console.error("[KokoroChunks] speak error:", err);
                resolve(); // Resolve anyway to avoid blocking the main reading loop
            }
        });
    }
}

window.ZenTTSKokoro = ZenTTSKokoro;
