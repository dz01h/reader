/**
 * matcha.js — ZenTTSMatcha
 * 獨立的 Matcha TTS 引擎 (Option B: 暫時共用 sherpa-onnx WASM)
 */

window.MATCHA_MODELS = {
    'matcha-icefall-zh-baker': {
        name: 'Matcha Baker (高音質女聲)',
        engine: 'matcha',
        sampleRate: 22050,
        files: {
            acousticModel: 'https://huggingface.co/csukuangfj/matcha-icefall-zh-baker/resolve/main/model-steps-3.onnx',
            vocoder: 'https://huggingface.co/csukuangfj/sherpa-onnx-hifigan/resolve/main/hifigan_v2.onnx',
            tokens: 'https://huggingface.co/csukuangfj/matcha-icefall-zh-baker/resolve/main/tokens.txt'
        },
        speakers: {
            0: 'Baker 女聲',
        },
    },
    'matcha-icefall-zh-en': {
        name: 'Matcha 中英雙語 (高速)',
        engine: 'matcha',
        sampleRate: 16000,
        files: {
            acousticModel: 'https://huggingface.co/csukuangfj/matcha-icefall-zh-en/resolve/main/model-steps-3.onnx',
            vocoder: 'https://modelscope.cn/models/dengcunqin/matcha_tts_zh_en_20251010/resolve/master/vocos-16khz-univ.onnx',
            tokens: 'https://huggingface.co/csukuangfj/matcha-icefall-zh-en/resolve/main/tokens.txt'
        },
        speakers: {
            0: '預設說話人',
        },
    }
};

class ZenTTSMatcha {
    constructor(app) {
        this.app = app;
        this.pool = null;
        this.voicePool = new Map();

        this.audioCtx = null;
        this.compressor = null;
        this.nextStartTime = 0;
        this._scheduledSources = [];
        this._lastRawText = null;
        this.isManualSuspended = false;

        this._workerReady = false;
        this._workerReadyPromise = null;
        this._workerReadyResolve = null;
        this._currentModelKey = null;

        this._setupAudioContext();
        this._createWorker();
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

    _parseVoiceId(voiceId) {
        let parts = (voiceId || 'matcha-icefall-zh-en:0').split(':');
        if (parts[0] === 'matcha') {
            parts.shift();
        }
        const modelKey = parts[0] || 'matcha-icefall-zh-en';
        const sid = parseInt(parts[1] || '0', 10);
        return { modelKey, sid };
    }

    _createWorker() {
        this._workerReady = false;
        this._workerReadyPromise = new Promise(r => this._workerReadyResolve = r);

        if (this.pool) {
            this.pool.clear(true);
        }

        this.pool = new MatchaWorkerPool(2, this);
    }

    async _ensureModelLoaded(modelKey) {
        if (this._workerReady && this._currentModelKey === modelKey) return;

        if (this._currentModelKey !== null && this._currentModelKey !== modelKey) {
            this._createWorker();
        }

        this._currentModelKey = modelKey;
        const modelDef = window.MATCHA_MODELS[modelKey];
        if (!modelDef) throw new Error(`未知模型: ${modelKey}`);

        const modelConfig = {
            engine: modelDef.engine || 'matcha',
            files: modelDef.files,
        };

        this.pool.initWorkers(modelConfig);

        await this._workerReadyPromise;
    }

    _dispatch() {
        if (!this._workerReady) return;
        this.pool.dispatch();
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

        const currentChunks = this._splitText(text);
        const nextChunks = this._splitText(readingData.nextReading);
        const allNeededKeys = new Set([...currentChunks, ...nextChunks]);

        const newVoicePool = new Map();
        for (const key of allNeededKeys) {
            if (this.voicePool.has(key)) {
                newVoicePool.set(key, this.voicePool.get(key));
            } else {
                let resolveFunc = null;
                const promise = new Promise(r => resolveFunc = r);
                newVoicePool.set(key, { status: 'pending', buffer: null, promise, resolve: resolveFunc });
            }
        }
        this.voicePool = newVoicePool;

        const voiceId = this.app.ttsVoice || 'matcha-icefall-zh-en:0';
        const { modelKey } = this._parseVoiceId(voiceId);

        this._ensureModelLoaded(modelKey).catch(err => {
            console.error('[ZenTTSMatcha] 模型載入失敗:', err);
        });

        if (this._workerReady) {
            this._dispatch();
        }

        return new ZenTTSMatchaChunks(this, currentChunks);
    }

    async getVoiceFromPool(text) {
        const item = this.voicePool.get(text);
        if (!item) return null;
        if (item.status === 'done') return item.buffer;
        await item.promise;
        return item.buffer;
    }

    playBuffer(audioBuffer) {
        if (this.audioCtx.state === 'suspended' && !this.isManualSuspended) {
            this.audioCtx.resume();
        }

        const source = this.audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.playbackRate.value = 1.0;

        const gainNode = this.audioCtx.createGain();
        source.connect(gainNode);
        gainNode.connect(this.compressor);

        const now = this.audioCtx.currentTime;
        const start = Math.max(now, this.nextStartTime);
        const duration = audioBuffer.duration;

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

    stopAudio(hardClear = true) {
        this._scheduledSources.forEach(s => {
            try { s.stop(); } catch (e) {}
            s.disconnect();
        });
        this._scheduledSources = [];
        this.nextStartTime = 0;
        this.suspendAudio();

        if (hardClear) {
            for (const [, item] of this.voicePool.entries()) {
                if (item.status === 'pending' || item.status === 'computing') {
                    item.status = 'done';
                    item.buffer = null;
                    if (item.resolve) item.resolve(null);
                }
            }
            this.voicePool.clear();
            this._lastRawText = null;
        }
    }

    destroy() {
        this.stopAudio(true);
        if (this.pool) {
            this.pool.clear(true);
            this.pool = null;
        }
        if (this.audioCtx) {
            try { this.audioCtx.close(); } catch (e) {}
            this.audioCtx = null;
        }
        this._workerReady = false;
    }
}

class ZenTTSMatchaChunks extends ZenTTSChunker {
    constructor(engine, chunks) {
        super('', null);
        this.engine = engine;
        this.chunks = chunks;
    }

    async speak() {
        const text = this.next();
        if (!text) return;

        const audioBuffer = await this.engine.getVoiceFromPool(text);
        if (!audioBuffer) return;

        document.body.dispatchEvent(new CustomEvent('ZenTTS:ChunkPlaying', { detail: { text } }));

        return new Promise(resolve => {
            const source = this.engine.playBuffer(audioBuffer);
            const originalOnEnded = source.onended;
            source.onended = (e) => {
                if (originalOnEnded) originalOnEnded(e);
                setTimeout(() => resolve(), 300);
            };
        });
    }
}

class MatchaWorkerPool {
    constructor(size = 2, engine) {
        this.size = size;
        this.engine = engine;
        this.workers = [];
        this._sessionId = 0;
        this.readyCount = 0;

        for (let i = 0; i < size; i++) {
            this._createWorker();
        }
    }

    _createWorker() {
        const w = new Worker('js/tts/matcha-worker.js');
        w._busy = false;
        w.onmessage = (e) => this._onWorkerMsg(w, e.data);
        w.onerror = (err) => console.error('[ZenTTSMatcha] Worker error:', err);
        this.workers.push(w);
    }

    initWorkers(modelConfig) {
        this.readyCount = 0;
        this.modelConfig = modelConfig;
        for (const w of this.workers) {
            w.postMessage({ type: 'INIT', modelConfig });
        }
    }

    dispatch() {
        const pendingKeys = [];
        for (const [key, item] of this.engine.voicePool.entries()) {
            if (item.status === 'pending') {
                pendingKeys.push(key);
            }
        }

        for (const w of this.workers) {
            if (!w._busy && pendingKeys.length > 0) {
                const key = pendingKeys.shift();
                const item = this.engine.voicePool.get(key);
                if (item) item.status = 'computing';
                
                w._busy = true;
                const voiceId = this.engine.app.ttsVoice || 'matcha-icefall-zh-en:0';
                const { modelKey, sid } = this.engine._parseVoiceId(voiceId);
                const speed = this.engine.app.ttsSpeed || 1.0;

                w.postMessage({ type: 'SYNTHESIZE', text: key, sid, speed, sessionId: this._sessionId });
            }
        }
    }

    _onWorkerMsg(worker, data) {
        if (data.type === 'READY') {
            this.readyCount++;
            if (this.readyCount === this.size) {
                this.engine._workerReady = true;
                document.body.dispatchEvent(new CustomEvent('ZenTTS:Status', { detail: { status: 'ready' } }));
                if (this.engine._workerReadyResolve) this.engine._workerReadyResolve();
                this.dispatch();
            }
            return;
        }

        if (data.type === 'INIT_PROGRESS') {
            if (worker === this.workers[0]) {
                document.body.dispatchEvent(new CustomEvent('ZenTTS:Status', { detail: { status: 'loading', message: data.message } }));
            }
            return;
        }

        worker._busy = false;

        if (data.type === 'DONE') {
            const item = this.engine.voicePool.get(data.text);
            if (item) {
                this.engine._setupAudioContext();
                const sampleRate = data.sampleRate || 22050;
                try {
                    const audioBuffer = this.engine.audioCtx.createBuffer(1, data.samples.length, sampleRate);
                    audioBuffer.copyToChannel(data.samples, 0);
                    const currentItem = this.engine.voicePool.get(data.text);
                    if (currentItem) {
                        currentItem.status = 'done';
                        currentItem.buffer = audioBuffer;
                        if (currentItem.resolve) currentItem.resolve(audioBuffer);
                    }
                } catch (err) {
                    console.error('[ZenTTSMatcha] createBuffer error:', err);
                    const currentItem = this.engine.voicePool.get(data.text);
                    if (currentItem) {
                        currentItem.status = 'done';
                        currentItem.buffer = null;
                        if (currentItem.resolve) currentItem.resolve(null);
                    }
                }
            }
        } else if (data.type === 'ERROR') {
            console.error('[ZenTTSMatcha] Worker ERROR:', data.error, 'text:', data.text);
            if (worker === this.workers[0]) {
                document.body.dispatchEvent(new CustomEvent('ZenTTS:Status', { detail: { status: 'error', message: data.error } }));
            }
            const item = this.engine.voicePool.get(data.text);
            if (item) {
                item.status = 'done';
                item.buffer = null;
                if (item.resolve) item.resolve(null);
            }
        }

        this.dispatch();
    }

    clear(hard = false) {
        if (hard) {
            this.workers.forEach(w => {
                try { w.terminate(); } catch(e) {}
            });
            this.workers = [];
            for (let i = 0; i < this.size; i++) {
                this._createWorker();
            }
            if (this.modelConfig) {
                this.initWorkers(this.modelConfig);
            }
        }
    }
}

window.ZenTTSMatcha = ZenTTSMatcha;
