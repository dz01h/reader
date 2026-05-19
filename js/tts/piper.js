class ZenTTSPiper {
    constructor(app) {
        this.app = app;
        this.pool = new PiperWorkerPool(2, this);
        this.voicePool = new Map(); // text -> { status, buffer, promise, resolve }
        
        this.audioCtx = null;
        this.compressor = null;
        this.nextStartTime = 0;
        this._scheduledSources = [];
        
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

    _splitText(text) {
        if (!text) return [];
        return text.split(/[\n，。、；：！？－—…]+/)
            .map(s => s.replace(/\p{P}/gu, '').trim())
            .filter(s => s.length > 0);
    }

    prepare(readingData) {
        let text = readingData.reading;

        // 如果是翻頁（文字有變動），比對原始字串找出精確的跨頁重疊部分並移除
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
        const nextChunks = this._splitText(readingData.nextReading);

        const allNeededKeys = new Set([...currentChunks, ...nextChunks]);

        // Reorder and GC VoicePool keys to match the new needed keys order
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

        // Trigger worker processing
        this.pool.dispatch();

        return new ZenTTSPiperChunks(this, currentChunks);
    }

    async getVoiceFromPool(text) {
        const item = this.voicePool.get(text);
        if (!item) return null;
        if (item.status === 'done') return item.buffer;
        await item.promise;
        return item.buffer;
    }

    deleteFromPool(text) {
        this.voicePool.delete(text);
    }

    playBuffer(audioBuffer) {
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }

        const source = this.audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.playbackRate.value = this.app.ttsSpeed || 1.0;
        
        const gainNode = this.audioCtx.createGain();
        source.connect(gainNode);
        gainNode.connect(this.compressor);

        const now = this.audioCtx.currentTime;
        const start = Math.max(now, this.nextStartTime);
        const duration = audioBuffer.duration / source.playbackRate.value;

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
        if (this.audioCtx && this.audioCtx.state === 'running') {
            this.audioCtx.suspend();
        }
    }

    resumeAudio() {
        if (this.audioCtx && this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }
    }
    
    stopAudio(hardClear = true) {
        this._scheduledSources.forEach(s => {
            try { s.stop(); } catch(e){}
            s.disconnect();
        });
        this._scheduledSources = [];
        this.nextStartTime = 0;
        this.suspendAudio();
        
        if (hardClear) {
            this.pool.clear(true);
            this._lastRawText = null;
        }
    }

    destroy() {
        this.stopAudio(true);
        // Explicitly terminate all workers to free WASM memory
        this.pool.workers.forEach(w => {
            try { w.terminate(); } catch(e) {}
        });
        this.pool.workers = [];
        this.voicePool.clear();
        
        if (this.audioCtx) {
            try { this.audioCtx.close(); } catch(e) {}
            this.audioCtx = null;
        }
    }
}

class ZenTTSPiperChunks extends ZenTTSChunker {
    constructor(engine, chunks) {
        super('', null);
        this.engine = engine;
        this.chunks = chunks; 
    }

    async speak() {
        const text = this.next();
        if (!text) return;

        // Fetch from VoicePool (waits if computing)
        const audioBuffer = await this.engine.getVoiceFromPool(text);
        if (!audioBuffer) return;

        // Notify controller to update MediaSession metadata
        document.body.dispatchEvent(new CustomEvent('ZenTTS:ChunkPlaying', { detail: { text } }));

        return new Promise(resolve => {
            const source = this.engine.playBuffer(audioBuffer);
            // Hijack the onended to resolve the promise when playback finishes, preserving original onended
            const originalOnEnded = source.onended;
            source.onended = (e) => {
                if (originalOnEnded) originalOnEnded(e);
                // Add a natural pause between chunks (300ms)
                setTimeout(() => resolve(), 300);
            };
        });
    }
}

class PiperWorkerPool {
    constructor(size = 2, engine) {
        this.size = size;
        this.engine = engine;
        this.workers = [];
        this._sessionId = 0;
        this._nextWorkerId = 1;

        for (let i = 0; i < size; i++) {
            this._createWorker();
        }
    }

    _createWorker() {
        const w = new Worker('js/tts/piper-worker.js', { type: 'module' });
        w._busy = false;
        w._workerId = this._nextWorkerId++;
        w.postMessage({ type: 'INIT', workerId: w._workerId });
        w.onmessage = (e) => this._onWorkerMsg(w, e.data);
        this.workers.push(w);
    }

    _restartWorker(deadWorker) {
        console.warn(`[PiperWorkerPool] Restarting crashed Worker-${deadWorker._workerId} (WASM abort)`);
        const idx = this.workers.indexOf(deadWorker);
        if (idx !== -1) this.workers.splice(idx, 1);
        try { deadWorker.terminate(); } catch(e) {}
        // New worker will send READY when INIT completes, which triggers dispatch()
        this._createWorker();
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
                w._sessionId = this._sessionId;
                w.postMessage({ type: 'SYNTHESIZE', text: key, voiceId: this.engine.app.ttsVoice || 'zh_CN-huayan-medium', sessionId: this._sessionId });
            }
        }
    }

    _onWorkerMsg(worker, data) {
        if (data.type === 'READY') {
            // Worker finished INIT — now it's available; trigger dispatch to assign pending work
            this.dispatch();
            return;
        }

        worker._busy = false;

        if (data.type === 'DONE') {
            const item = this.engine.voicePool.get(data.text);
            if (item) {
                this.engine._setupAudioContext();
                this.engine.audioCtx.decodeAudioData(data.buffer)
                    .then(audioBuffer => {
                        const currentItem = this.engine.voicePool.get(data.text);
                        if (currentItem) {
                            currentItem.status = 'done';
                            currentItem.buffer = audioBuffer;
                            if (currentItem.resolve) currentItem.resolve(audioBuffer);
                        }
                    })
                    .catch(err => {
                        console.error('Failed to decode audio data for:', data.text, err);
                        const currentItem = this.engine.voicePool.get(data.text);
                        if (currentItem) {
                            currentItem.status = 'done';
                            currentItem.buffer = null;
                            if (currentItem.resolve) currentItem.resolve(null);
                        }
                    });
            }
        } else if (data.type === 'ERROR') {
            const item = this.engine.voicePool.get(data.text);
            if (item) {
                item.status = 'done';
                item.buffer = null;
                if (item.resolve) item.resolve(null);
            }
            // WASM heap may be corrupted after any synthesis error — replace the worker.
            // dispatch() will be called automatically when the new worker sends READY.
            this._restartWorker(worker);
            return;
        }

        // Worker is now free — pick up the next pending item in the VoicePool
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
        }
        // If hard=false, we do nothing to the workers. They will finish their 
        // current computing tasks, and the new VoicePool GC will naturally
        // discard the results if they are no longer needed, or keep them if they are.
    }
}

window.ZenTTSPiper = ZenTTSPiper;