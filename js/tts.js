// ─── Worker Pool ──────────────────────────────────────────────────────────────
// Manages N parallel VITS workers with ordered MP3 output.
class TTSWorkerPool {
    constructor(size = 2) {
        this.size = size;
        this.workers = [];
        this.pendingQueue = [];   // { index, text, voiceId }
        this.resultBuffer = {};   // index → Uint8Array
        this.nextDispatchIdx = 0;
        this.nextFlushIdx = 0;
        this.totalChunks = 0;

        // Callbacks set by ZenTTS
        this.onData = null;       // (Uint8Array) → void
        this.onChunkDone = null;  // (text) → void
        this.onAllDone = null;    // () → void

        for (let i = 0; i < size; i++) {
            const w = new Worker('js/tts-worker.js', { type: 'module' });
            w._busy = false;
            w.postMessage({ type: 'INIT' });
            w.onmessage = (e) => this._onWorkerMsg(w, e.data);
            this.workers.push(w);
        }
    }

    enqueue(chunks, voiceId) {
        this.pendingQueue = chunks.map((text, i) => ({ index: i, text, voiceId }));
        this.resultBuffer = {};
        this.nextFlushIdx = 0;
        this.totalChunks = chunks.length;
        this._dispatch();
    }

    clear() {
        this.pendingQueue = [];
        this.resultBuffer = {};
        this.nextFlushIdx = 0;
        this.totalChunks = 0;
        // Mark workers idle; in-flight results will be ignored by stale index check
        this.workers.forEach(w => w._busy = false);
        this._sessionId = (this._sessionId || 0) + 1;
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

// ─── ZenTTS ──────────────────────────────────────────────────────────────────
class ZenTTS {
    constructor(app) {
        this.app = app;

        this.isPlaying = false;
        this.currentText = "";
        this.chunks = [];
        this.isWaitingForNextPage = false;

        this._pendingPlay = false;
        this._bufferedChunks = 0;
        this._PLAY_AFTER_CHUNKS = 1; // start play after N sentences buffered in SW

        this.initDOM();
        this.bindEvents();
        this.debugLog("TTS initialized (WorkerPool x2 + SW Proxy)");
    }

    debugLog(msg) {
        console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
    }

    initDOM() {
        this.els = {
            btnToggle: document.getElementById('btn-tts-toggle'),
            icon: document.getElementById('tts-icon'),
            speed: document.getElementById('tts-speed')
        };

        if (this.els.speed && this.app.ttsSpeed) {
            this.els.speed.value = this.app.ttsSpeed;
        }

        // Worker pool: 2 parallel VITS workers
        this.pool = new TTSWorkerPool(2);

        this.pool.onData = (buffer, _unused, text) => {
            console.log(`[MSE append] ${text}`);
            this._appendToSourceBuffer(buffer);
        };

        this.pool.onChunkDone = (text) => {
            this._bufferedChunks++;
            this.updateMediaMetadata(text);
            if (this._pendingPlay && this._bufferedChunks >= this._PLAY_AFTER_CHUNKS) {
                this._pendingPlay = false;
                this._startAudioPlayback();
            }
        };

        this.pool.onAllDone = () => {
            this.debugLog("All chunks synthesized");
            if (this._pendingPlay) {
                this._pendingPlay = false;
                this._startAudioPlayback();
            }
            // Only call endOfStream if data was actually appended (past HAVE_METADATA)
            if (this._mediaSource && this._mediaSource.readyState === 'open' && this._hasAppendedData) {
                const end = () => {
                    try { this._mediaSource.endOfStream(); } catch(e){}
                };
                if (this._sourceBuffer && this._sourceBuffer.updating) {
                    this._sourceBuffer.addEventListener('updateend', end, { once: true });
                } else {
                    end();
                }
            }
        };

        // Audio player
        this.audioPlayer = new Audio();
        this.audioPlayer.id = "tts-master-player";
        this.audioPlayer.style.display = "none";
        document.body.appendChild(this.audioPlayer);

        const log = (label, extra = '') => {
            const t = this.audioPlayer.currentTime?.toFixed(2) ?? '?';
            const buf = this.audioPlayer.buffered?.length
                ? this.audioPlayer.buffered.end(this.audioPlayer.buffered.length - 1).toFixed(2)
                : '?';
            this.debugLog(`[audio] ${label} | t=${t}s buf=${buf}s ${extra}`);
        };

        this.audioPlayer.addEventListener('loadstart',      () => log('loadstart'));
        this.audioPlayer.addEventListener('loadedmetadata', () => log('loadedmetadata'));
        this.audioPlayer.addEventListener('canplay',        () => log('canplay'));
        this.audioPlayer.addEventListener('canplaythrough', () => log('canplaythrough'));
        this.audioPlayer.addEventListener('play',           () => log('play'));
        this.audioPlayer.addEventListener('playing',        () => {
            const gap = this._waitingSince ? `gap=${(performance.now() - this._waitingSince).toFixed(0)}ms` : '';
            this._waitingSince = 0;
            log('playing ▶', gap);
        });
        this.audioPlayer.addEventListener('waiting',        () => {
            this._waitingSince = performance.now();
            log('waiting ⏳');
        });
        this.audioPlayer.addEventListener('stalled',        () => log('stalled ⚠'));
        this.audioPlayer.addEventListener('suspend',        () => log('suspend'));
        this.audioPlayer.addEventListener('pause',          () => log('pause'));
        this.audioPlayer.addEventListener('ended',          () => {
            log('ended ⏹');
            if (this.isPlaying) this.requestNextPage();
        });
        this.audioPlayer.addEventListener('error',          () => {
            const code = this.audioPlayer.error?.code;
            const msg = this.audioPlayer.error?.message || 'Unknown';
            log(`error ❌ code=${code} ${msg}`);
            if (this.isPlaying) {
                this.app.showToast("音訊串流中斷，正在換頁...");
                setTimeout(() => this.requestNextPage(), 800);
            }
        });

        // Throttled timeupdate (every ~2s) to track playback position
        let lastTimeLog = 0;
        this.audioPlayer.addEventListener('timeupdate', () => {
            const now = this.audioPlayer.currentTime;
            if (now - lastTimeLog >= 2) {
                lastTimeLog = now;
                log('timeupdate');
            }
        });


        this.initMediaSession();
    }

    initMediaSession() {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.setActionHandler('play', () => this.start());
            navigator.mediaSession.setActionHandler('pause', () => this.stop());
            navigator.mediaSession.setActionHandler('nexttrack', () => {
                document.body.dispatchEvent(new CustomEvent('ReadingOperation', { detail: { action: 'nextPage' } }));
            });
        }
    }

    updateMediaMetadata(chunkText = "") {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: this.app.els.documentTitle.textContent || 'Zen Reader',
                artist: 'Offline AI TTS',
                album: chunkText || '合成中...',
                artwork: [{ src: 'icon.svg', sizes: '512x512', type: 'image/svg+xml' }]
            });
            navigator.mediaSession.playbackState = this.isPlaying ? 'playing' : 'paused';
        }
    }

    bindEvents() {
        if (this.els.btnToggle) this.els.btnToggle.addEventListener('click', () => this.toggle());
        if (this.els.speed) {
            this.els.speed.addEventListener('change', (e) => {
                this.app.setTTSSpeed(parseFloat(e.target.value));
                if (this.audioPlayer) this.audioPlayer.playbackRate = parseFloat(e.target.value);
            });
        }

        document.body.addEventListener('ReadingOver', (e) => {
            const newText = e.detail.reading;
            if (this.currentText !== newText) {
                this.currentText = newText;
                this.prepareChunks();
                if (this.isPlaying) {
                    this.isWaitingForNextPage = false;
                    this.playCurrentPage();
                }
            }
        });
    }

    prepareChunks() {
        const MIN_LEN = 60;

        // Split on all punctuation, keeping delimiter at end of each fragment
        const fragments = this.currentText
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

        // Merge fragments until accumulated length >= MIN_LEN, then cut
        const chunks = [];
        let current = '';
        for (const frag of fragments) {
            current += frag;
            if (current.length >= MIN_LEN) {
                chunks.push(current);
                current = '';
            }
        }
        if (current) chunks.push(current); // flush remainder
        this.chunks = chunks;
    }

    toggle() {
        if (this.isPlaying) this.stop();
        else this.start();
    }

    stop() {
        this.isPlaying = false;
        this._pendingPlay = false;
        if (this.els.icon) this.els.icon.textContent = '▶';

        this.pool.clear();
        this._teardownMediaSource();
        this.audioPlayer.pause();
        this.updateMediaMetadata();
    }

    async start() {
        if (!this.currentText) this.app.readingPanel.render();
        this.isPlaying = true;
        this.isWaitingForNextPage = false;
        if (this.els.icon) this.els.icon.textContent = '⏸';
        this.playCurrentPage();
    }

    async playCurrentPage() {
        this.debugLog(`Page: ${this.chunks.length} chunks → WorkerPool x${this.pool.size}`);

        this._bufferedChunks = 0;
        this._pendingPlay = true;
        this._appendQueue = [];
        this._appendBusy = false;

        this.pool.clear();
        this._teardownMediaSource();
        this._setupMediaSource();

        this.audioPlayer.playbackRate = this.app.ttsSpeed || 1.0;

        // Start parallel synthesis — audio will play once _PLAY_AFTER_CHUNKS chunks are ready
        this.pool.enqueue(this.chunks, this.app.ttsVoice || 'zh_CN-huayan-medium');
        this.updateMediaMetadata(this.chunks[0]);
    }

    _setupMediaSource() {
        // MediaSource: browser is notified immediately on appendBuffer(), no polling
        this._mediaSource = new MediaSource();
        this._sourceBuffer = null;
        this._appendQueue = [];
        this._appendBusy = false;

        this._mediaSource.addEventListener('sourceopen', () => {
            this.debugLog('MediaSource opened');
            this._sourceBuffer = this._mediaSource.addSourceBuffer('audio/mpeg');
            this._sourceBuffer.addEventListener('updateend', () => {
                this._appendBusy = false;
                this._drainAppendQueue();
            });
            this._drainAppendQueue();
        }, { once: true });

        // Use srcObject if available (Chrome 108+) — more reliable than blob URL
        if ('srcObject' in this.audioPlayer && MediaSource.isTypeSupported !== undefined) {
            try {
                this.audioPlayer.srcObject = this._mediaSource;
            } catch(e) {
                // Fallback to blob URL
                this.audioPlayer.src = URL.createObjectURL(this._mediaSource);
                this.audioPlayer.load();
            }
        } else {
            this.audioPlayer.src = URL.createObjectURL(this._mediaSource);
            this.audioPlayer.load(); // explicitly trigger resource selection → sourceopen
        }
    }

    _teardownMediaSource() {
        // Just pause and clear internal state.
        // Setting audioPlayer.src to a new blob URL in _setupMediaSource()
        // will automatically abort the old source — no need for load() here.
        // (load() after removeAttribute was preventing sourceopen from firing)
        this.audioPlayer.pause();
        if (this._mediaSource && this.audioPlayer.src.startsWith('blob:')) {
            URL.revokeObjectURL(this.audioPlayer.src);
        }
        this._mediaSource = null;
        this._sourceBuffer = null;
        this._appendQueue = [];
        this._appendBusy = false;
        this._hasAppendedData = false;
    }

    _appendToSourceBuffer(buffer) {
        this._hasAppendedData = true;
        this._appendQueue.push(buffer);
        this._drainAppendQueue();
    }

    _drainAppendQueue() {
        if (this._appendBusy || !this._sourceBuffer || this._appendQueue.length === 0) return;
        if (this._mediaSource?.readyState !== 'open') return;
        if (this._sourceBuffer.updating) return;

        this._appendBusy = true;
        const next = this._appendQueue.shift();
        try {
            this._sourceBuffer.appendBuffer(next);
        } catch(e) {
            this.debugLog(`appendBuffer error: ${e.message}`);
            this._appendBusy = false;
        }
    }

    _startAudioPlayback() {
        this.debugLog(`Starting playback (${this._bufferedChunks} chunk(s) buffered)`);
        this.audioPlayer.play().catch(e => {
            this.debugLog(`play() failed: ${e.message}`);
            this.app.showToast(`音訊播放失敗: ${e.message}`);
            this.stop();
        });
    }

    requestNextPage() {
        if (this.isWaitingForNextPage) return;
        this.isWaitingForNextPage = true;
        document.body.dispatchEvent(new CustomEvent('ReadingOperation', { detail: { action: 'nextPage' } }));
    }
}

window.ZenTTS = ZenTTS;

