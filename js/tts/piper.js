class ZenTTSPiper {
    constructor() {
        this.pool = new PiperWorkerPool(2);

        this.pool.onData = (buffer, _unused, text) => {
            document.body.dispatchEvent(new CustomEvent('ZenTTS:AudioData', { 
                detail: { buffer, text } 
            }));
        };

        this.pool.onChunkDone = (text) => {
            document.body.dispatchEvent(new CustomEvent('ZenTTS:ChunkDone', { 
                detail: { 
                    text, 
                    nextFlushIdx: this.pool.nextFlushIdx, 
                    totalChunks: this.pool.totalChunks 
                } 
            }));
        };

        this.pool.onAllDone = () => {
            document.body.dispatchEvent(new CustomEvent('ZenTTS:AllDone'));
        };

        this._initListeners();
    }

    _initListeners() {
        document.body.addEventListener('ZenTTSPiper:Enqueue', (e) => {
            const { chunks, voiceId, isAppend } = e.detail;
            this.pool.enqueue(chunks, voiceId, isAppend);
        });

        document.body.addEventListener('ZenTTSPiper:Clear', (e) => {
            const hard = e.detail?.hard ?? false;
            this.pool.clear(hard);
        });
    }

    createChunks(text, parent = null) {
        return new ZenTTSPiperChunks(text, parent);
    }
}

class ZenTTSPiperChunks extends ZenTTSChunker {
    constructor(text, parent) {
        super(text, parent);
        this.chunks = this.text
            .split(/([\n，。、；：！？－—…])/)
            .reduce((acc, part, i) => {
                if (i % 2 === 0) {
                    if (part.trim()) acc.push(part);
                } else {
                    if (acc.length > 0) acc[acc.length - 1] += part;
                    else if (part.trim()) acc.push(part);
                }
                return acc;
            }, [])
            .filter(s => s.trim().length > 0);

        // 如果有上一頁最後一句，嘗試分割第一句以避免重複朗讀
        if (parent && this.chunks.length > 0) {
            const lastChunkOfPrev = parent.last();
            const first = this.chunks[0];
            if (first.includes(lastChunkOfPrev)) {
                const remaining = first.split(lastChunkOfPrev).pop().trim();
                if (remaining) {
                    this.chunks[0] = remaining;
                } else {
                    this.chunks.shift();
                }
            }
        }
    }
}

class PiperWorkerPool {
    constructor(size = 2) {
        this.size = size;
        this.workers = [];
        this.pendingQueue = [];   // { index, text, voiceId }
        this.resultBuffer = {};   // index → Uint8Array
        this.nextDispatchIdx = 0;
        this.nextFlushIdx = 0;
        this.totalChunks = 0;
        this._sessionId = 0;

        for (let i = 0; i < size; i++) {
            const w = new Worker('js/tts/piper-worker.js', { type: 'module' });
            w._busy = false;
            w.postMessage({ type: 'INIT' });
            w.onmessage = (e) => this._onWorkerMsg(w, e.data);
            this.workers.push(w);
        }
    }

    enqueue(chunks, voiceId, isAppend = false) {
        const startIdx = isAppend ? this.totalChunks : 0;
        const newItems = chunks.map((text, i) => ({ 
            index: startIdx + i, 
            text, 
            voiceId 
        }));

        if (isAppend) {
            this.pendingQueue.push(...newItems);
            this.totalChunks += chunks.length;
        } else {
            this.pendingQueue = newItems;
            this.resultBuffer = {};
            this.nextFlushIdx = 0;
            this.totalChunks = chunks.length;
            this.workers.forEach(w => w._busy = false);
            this._sessionId++;
        }
        this._dispatch();
    }

    clear(hard = false) {
        this.pendingQueue = [];
        this.resultBuffer = {};
        this.nextFlushIdx = 0;
        this.totalChunks = 0;
        this._sessionId++;

        if (hard) {
            // Terminate all workers immediately to free ONNX/WASM compute
            this.workers.forEach(w => w.terminate());
            this.workers = [];
            for (let i = 0; i < this.size; i++) {
                const w = new Worker('js/tts/piper-worker.js', { type: 'module' });
                w._busy = false;
                w.postMessage({ type: 'INIT' });
                w.onmessage = (e) => this._onWorkerMsg(w, e.data);
                this.workers.push(w);
            }
        } else {
            this.workers.forEach(w => w._busy = false);
        }
    }

    _dispatch() {
        for (const w of this.workers) {
            if (!w._busy && this.pendingQueue.length > 0) {
                const item = this.pendingQueue.shift();
                w._busy = true;
                w._sessionId = this._sessionId;
                w.postMessage({ type: 'SYNTHESIZE', ...item, sessionId: this._sessionId });
            }
        }
    }

    _onWorkerMsg(worker, data) {
        worker._busy = false;

        if (data.sessionId !== undefined && data.sessionId !== this._sessionId) {
            this._dispatch();
            return;
        }

        if (data.type === 'DONE') {
            this.resultBuffer[data.index] = {
                buffer: data.buffer,
                text: data.text
            };
            this._flush();
        } else if (data.type === 'ERROR') {
            this.resultBuffer[data.index] = { buffer: null, text: data.text || '' };
            this._flush();
        }

        this._dispatch();
    }

    _flush() {
        while (this.resultBuffer.hasOwnProperty(this.nextFlushIdx)) {
            const item = this.resultBuffer[this.nextFlushIdx];
            if (item.buffer && this.onData) {
                this.onData(item.buffer, null, item.text);
            }
            if (this.onChunkDone) this.onChunkDone(item.text);
            delete this.resultBuffer[this.nextFlushIdx];
            this.nextFlushIdx++;
        }

        const allFlushed = this.nextFlushIdx >= this.totalChunks;
        const allIdle = this.workers.every(w => !w._busy);
        const queueEmpty = this.pendingQueue.length === 0;
        if (allFlushed && allIdle && queueEmpty && this.totalChunks > 0) {
            if (this.onAllDone) this.onAllDone();
        }
    }
}

window.ZenTTSPiper = ZenTTSPiper;