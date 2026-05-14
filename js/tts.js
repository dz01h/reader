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
        this.isPaused = false;
        this._PLAY_AFTER_CHUNKS = 1; 

        // Audio Context for gapless playback
        this.audioCtx = null;
        this.nextStartTime = 0;
        this._scheduledSources = [];
        this._decodeChain = Promise.resolve();

        this.initDOM();
        this.bindEvents();
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
            this._appendToWavQueue(buffer);
        };

        this.pool.onChunkDone = (text) => {
            this._bufferedChunks++;
            this.updateMediaMetadata(text);
        };

        this.pool.onAllDone = () => {};

        // Audio player
        this.audioPlayer = new Audio();
        this.audioPlayer.id = "tts-master-player";
        this.audioPlayer.style.display = "none";
        document.body.appendChild(this.audioPlayer);

        this.audioPlayer.addEventListener('ended', () => {
            // With MediaStream, ended only fires if the stream is closed.
            // We handle page transitions via the scheduler now.
        });
        this.audioPlayer.addEventListener('error', () => {
            if (this.isPlaying) {
                this.app.showToast("音訊串流中斷，正在換頁...");
                setTimeout(() => this.requestNextPage(), 800);
            }
        });

        this.initMediaSession();
    }

    initMediaSession() {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.setActionHandler('play', () => {
                if (this.isPaused) this.resume();
                else this.start();
            });
            navigator.mediaSession.setActionHandler('pause', () => this.pause());
            navigator.mediaSession.setActionHandler('nexttrack', () => {
                document.body.dispatchEvent(new CustomEvent('ReadingOperation', { detail: { action: 'nextPage' } }));
            });
            navigator.mediaSession.setActionHandler('previoustrack', () => {
                document.body.dispatchEvent(new CustomEvent('ReadingOperation', { detail: { action: 'prevPage' } }));
            });
        }
    }

    updateMediaMetadata(chunkText = "") {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: this.app.els.documentTitle?.textContent || 'Zen Reader',
                artist: 'Offline AI TTS',
                album: chunkText || '合成中...',
                artwork: [{ src: 'icon.svg', sizes: '512x512', type: 'image/svg+xml' }]
            });
            navigator.mediaSession.playbackState = this.isPlaying ? 'playing' : (this.isPaused ? 'paused' : 'none');
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
        // Split on all punctuation, keeping delimiter at end of each fragment
        this.chunks = this.currentText
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
    }

    toggle() {
        if (this.isPlaying) {
            this.pause();
        } else if (this.isPaused) {
            this.resume();
        } else {
            this.start();
        }
    }

    pause() {
        if (!this.isPlaying) return;
        this.isPlaying = false;
        this.isPaused = true;
        if (this.els.icon) this.els.icon.textContent = '▶';
        
        if (this.audioCtx && this.audioCtx.state === 'running') {
            this.audioCtx.suspend();
        }
        this.audioPlayer.pause();
        this.updateMediaMetadata();
    }

    resume() {
        if (!this.isPaused) return;
        this.isPlaying = true;
        this.isPaused = false;
        if (this.els.icon) this.els.icon.textContent = '⏸';
        
        if (this.audioCtx && this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }
        this.audioPlayer.play().catch(e => console.error(`audioPlayer.play() error: ${e.message}`));
        this.updateMediaMetadata();
    }

    stop() {
        this.isPlaying = false;
        this.isPaused = false;
        if (this.els.icon) this.els.icon.textContent = '▶';

        this.pool.clear();
        this._clearAudioContext();
        this.audioPlayer.pause();
        this.updateMediaMetadata();
    }

    async start() {
        if (!this.currentText) this.app.readingPanel.render();
        this.isPlaying = true;
        this.isPaused = false;
        this.isWaitingForNextPage = false;
        if (this.els.icon) this.els.icon.textContent = '⏸';
        this.playCurrentPage();
    }

    async playCurrentPage() {
        this._bufferedChunks = 0;

        this.pool.clear();
        this._setupAudioContext();

        // Play MUST be called synchronously here to capture the user gesture on mobile
        this.audioPlayer.play().catch(e => console.error(`audioPlayer.play() error: ${e.message}`));

        this.audioPlayer.playbackRate = this.app.ttsSpeed || 1.0;

        // Start parallel synthesis
        this.pool.enqueue(this.chunks, this.app.ttsVoice || 'zh_CN-huayan-medium');
        this.updateMediaMetadata(this.chunks[0]);
    }

    _setupAudioContext() {
        if (!this.audioCtx) {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            
            // Add compressor to prevent clipping
            this.compressor = this.audioCtx.createDynamicsCompressor();
            this.compressor.threshold.setValueAtTime(-1.0, this.audioCtx.currentTime);
            this.compressor.knee.setValueAtTime(40, this.audioCtx.currentTime);
            this.compressor.ratio.setValueAtTime(12, this.audioCtx.currentTime);
            this.compressor.attack.setValueAtTime(0, this.audioCtx.currentTime);
            this.compressor.release.setValueAtTime(0.25, this.audioCtx.currentTime);

            // Connect directly to hardware speakers
            this.compressor.connect(this.audioCtx.destination);
            
            // Play a silent background track to keep OS awake and enable MediaSession
            this.audioPlayer.loop = true;
            this.audioPlayer.src = this._createSilentAudioURL(15);

        }
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }
        this.nextStartTime = this.audioCtx.currentTime + 0.2; // slightly more buffer
        this._scheduledSources = [];
    }

    _clearAudioContext() {
        this._scheduledSources.forEach(s => {
            try { s.stop(); } catch(e){}
            s.disconnect();
        });
        this._scheduledSources = [];
        this._decodeChain = Promise.resolve();
        if (this.audioCtx && this.audioCtx.state !== 'closed') {
            // We don't close it, just suspend to reuse
            this.audioCtx.suspend();
        }
    }

    _appendToWavQueue(buffer) {
        if (!this.audioCtx) return;

        this._decodeChain = this._decodeChain.then(async () => {
            try {
                const audioBuffer = await this.audioCtx.decodeAudioData(buffer);
                this._scheduleBuffer(audioBuffer);
            } catch (e) {
                console.error(`decodeAudioData error: ${e.message}`);
            }
        });
    }

    _createSilentAudioURL(seconds) {
        const sampleRate = 8000;
        const numChannels = 1;
        const bitsPerSample = 16;
        const blockAlign = numChannels * (bitsPerSample / 8);
        const byteRate = sampleRate * blockAlign;
        const dataSize = seconds * byteRate;
        const buffer = new ArrayBuffer(44 + dataSize);
        const view = new DataView(buffer);

        const writeString = (offset, string) => {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        };

        writeString(0, 'RIFF');
        view.setUint32(4, 36 + dataSize, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true); // PCM
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, byteRate, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitsPerSample, true);
        writeString(36, 'data');
        view.setUint32(40, dataSize, true);

        const blob = new Blob([buffer], { type: 'audio/wav' });
        return URL.createObjectURL(blob);
    }

    _scheduleBuffer(audioBuffer) {
        if (!this.isPlaying || !this.audioCtx) return;

        const source = this.audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.playbackRate.value = this.app.ttsSpeed || 1.0;
        
        // Use a GainNode for a tiny fade-in/out to prevent clicks at boundaries
        const gainNode = this.audioCtx.createGain();
        source.connect(gainNode);
        gainNode.connect(this.compressor);

        const now = this.audioCtx.currentTime;
        const start = Math.max(now, this.nextStartTime);
        const duration = audioBuffer.duration / (this.app.ttsSpeed || 1.0);

        // 5ms fade in/out
        const fadeTime = 0.005;
        gainNode.gain.setValueAtTime(0, start);
        gainNode.gain.linearRampToValueAtTime(1, start + fadeTime);
        gainNode.gain.setValueAtTime(1, start + duration - fadeTime);
        gainNode.gain.linearRampToValueAtTime(0, start + duration);

        source.start(start);
        this._scheduledSources.push(source);

        this.nextStartTime = start + duration;

        // Handle end of page
        source.onended = () => {
            // Remove from list
            this._scheduledSources = this._scheduledSources.filter(s => s !== source);
            
            // Check if this was the last chunk of the page
            if (this._scheduledSources.length === 0 && 
                this.pool.nextFlushIdx >= this.pool.totalChunks && 
                this.pool.totalChunks > 0) {
                
                // Give a tiny buffer before next page
                setTimeout(() => {
                    if (this.isPlaying && this._scheduledSources.length === 0) {
                        this.requestNextPage();
                    }
                }, 200);
            }
        };
    }

    requestNextPage() {
        if (this.isWaitingForNextPage) return;
        this.isWaitingForNextPage = true;
        document.body.dispatchEvent(new CustomEvent('ReadingOperation', { detail: { action: 'nextPage' } }));
    }
}

window.ZenTTS = ZenTTS;

