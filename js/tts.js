// ─── ZenTTS (Controller & Playback) ──────────────────────────────────────────
class ZenTTS {
    constructor(app) {
        this.app = app;

        this.isPlaying = false;
        this.currentText = "";
        this.chunks = null;
        this.ttsEngine = null;
        this.isWaitingForNextPage = false;
        this.isPaused = false;
        this._synthDone = true;
        this._lastReadingText = null; // tracks visible text to detect actual page change

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

        // Audio player
        this.audioPlayer = new Audio();
        this.audioPlayer.id = "tts-master-player";
        this.audioPlayer.style.display = "none";
        document.body.appendChild(this.audioPlayer);

        this.audioPlayer.addEventListener('error', () => {
            if (this.isPlaying) {
                this.app.showToast("音訊串流中斷，正在換頁...");
                setTimeout(() => this.requestNextPage(), 800);
            }
        });

        if (window.ZenTTSPiper) {
            this.ttsEngine = new window.ZenTTSPiper();
        }

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
            const textChanged = newText !== this._lastReadingText;
            this._lastReadingText = newText;

            if (!this.chunks || !this.ttsEngine) {
                // First load: initialize chunks only
                this.chunks = this.ttsEngine ? this.ttsEngine.createChunks(newText) : null;
                return;
            }

            if (this.isWaitingForNextPage) {
                // ── Auto page turn (TTS triggered): append new chunks seamlessly ──
                this.isWaitingForNextPage = false;
                this.chunks = this.chunks.append(newText);
                // After append(), this.chunks.chunks contains ONLY the new page's chunks
                const newChunks = this.chunks.chunks;
                if (newChunks.length > 0 && this.isPlaying) {
                    this._synthDone = false;
                    document.body.dispatchEvent(new CustomEvent('ZenTTSPiper:Enqueue', {
                        detail: { 
                            chunks: newChunks, 
                            voiceId: this.app.ttsVoice || 'zh_CN-huayan-medium',
                            isAppend: true
                        }
                    }));
                }
            } else if (textChanged) {
                // ── Text genuinely changed (manual page turn or jump) ──
                this.chunks = this.ttsEngine.createChunks(newText);
                if (this.isPlaying || this.isPaused) {
                    // Interrupt current synthesis and restart for new page
                    this._resetAndPlayCurrentPage();
                }
            }
            // If !textChanged && !isWaitingForNextPage: same page re-render, do nothing
        });

        // Listen for Piper Engine output
        document.body.addEventListener('ZenTTS:AudioData', (e) => {
            const { buffer, text } = e.detail;
            this._appendToWavQueue(buffer);
        });

        document.body.addEventListener('ZenTTS:ChunkDone', (e) => {
            const { text, nextFlushIdx, totalChunks } = e.detail;
            this.updateMediaMetadata(text);
            
            // Trigger next page when synthesis queue is exhausted
            if (nextFlushIdx >= totalChunks && totalChunks > 0) {
                this._synthDone = true;
                if (this.isPlaying) this.requestNextPage();
            }
        });
    }

    toggle() {
        if (this.isPlaying) {
            this.pause();
        } else if (this.isPaused) {
            // If synthesis is exhausted and no audio is scheduled, restart fresh
            if (this._synthDone && this._scheduledSources.length === 0) {
                this.isPaused = false;
                this.start();
            } else {
                this.resume();
            }
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

        document.body.dispatchEvent(new CustomEvent('ZenTTSPiper:Clear'));
        this._clearAudioContext();
        this.audioPlayer.pause();
        this.updateMediaMetadata();
    }

    async start() {
        if (!this.chunks) this.app.readingPanel.render();
        this.isPlaying = true;
        this.isPaused = false;
        this.isWaitingForNextPage = false;
        if (this.els.icon) this.els.icon.textContent = '⏸';
        this.playCurrentPage();
    }

    async playCurrentPage() {
        if (!this.chunks || this.chunks.chunks.length === 0) return;

        this._synthDone = false;
        this._clearAudioContext();
        this._setupAudioContext();

        // Play MUST be called synchronously here to capture the user gesture on mobile
        this.audioPlayer.play().catch(e => console.error(`audioPlayer.play() error: ${e.message}`));
        this.audioPlayer.playbackRate = this.app.ttsSpeed || 1.0;

        // Tell Piper Engine to synthesize (fresh start, not append)
        document.body.dispatchEvent(new CustomEvent('ZenTTSPiper:Enqueue', {
            detail: { 
                chunks: this.chunks.chunks, 
                voiceId: this.app.ttsVoice || 'zh_CN-huayan-medium',
                isAppend: false
            }
        }));

        this.updateMediaMetadata(this.chunks.chunks[0]);
    }

    _resetAndPlayCurrentPage() {
        // Used for manual page turn during playback
        this._synthDone = false;
        // Hard clear: terminate in-flight ONNX workers to reclaim compute immediately
        document.body.dispatchEvent(new CustomEvent('ZenTTSPiper:Clear', { detail: { hard: true } }));
        this._clearAudioContext();
        this._setupAudioContext();
        this.audioPlayer.play().catch(e => console.error(`audioPlayer.play() error: ${e.message}`));
        this.audioPlayer.playbackRate = this.app.ttsSpeed || 1.0;

        if (!this.chunks || this.chunks.chunks.length === 0) return;
        document.body.dispatchEvent(new CustomEvent('ZenTTSPiper:Enqueue', {
            detail: { 
                chunks: this.chunks.chunks, 
                voiceId: this.app.ttsVoice || 'zh_CN-huayan-medium',
                isAppend: false
            }
        }));
        this.updateMediaMetadata(this.chunks.chunks[0]);
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
            
            this.audioPlayer.loop = true;
        }

        // Always ensure audioPlayer has a valid source if playing
        // Use a short, standard 44.1kHz silent WAV to avoid demuxer issues
        if (!this.audioPlayer.src || this.audioPlayer.src.length < 10) {
            this.audioPlayer.src = this._createSilentAudioURL(1);
        }

        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }

        const now = this.audioCtx.currentTime;
        if (this.nextStartTime < now) {
            this.nextStartTime = now + 0.1;
            this._scheduledSources = [];
        }
    }

    _clearAudioContext() {
        this._scheduledSources.forEach(s => {
            try { s.stop(); } catch(e){}
            s.disconnect();
        });
        this._scheduledSources = [];
        this._decodeChain = Promise.resolve();
        this.nextStartTime = 0;
        if (this.audioCtx && this.audioCtx.state !== 'closed') {
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
        const sampleRate = 44100;
        const numChannels = 1;
        const bitsPerSample = 16;
        const blockAlign = numChannels * (bitsPerSample / 8);
        const byteRate = sampleRate * blockAlign;
        const dataSize = Math.floor(seconds * byteRate);
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
        if ((!this.isPlaying && !this.isPaused) || !this.audioCtx) return;

        const source = this.audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.playbackRate.value = this.app.ttsSpeed || 1.0;
        
        const gainNode = this.audioCtx.createGain();
        source.connect(gainNode);
        gainNode.connect(this.compressor);

        const now = this.audioCtx.currentTime;
        const start = Math.max(now, this.nextStartTime);
        const duration = audioBuffer.duration / (this.app.ttsSpeed || 1.0);

        const fadeTime = 0.005;
        gainNode.gain.setValueAtTime(0, start);
        gainNode.gain.linearRampToValueAtTime(1, start + fadeTime);
        gainNode.gain.setValueAtTime(1, start + duration - fadeTime);
        gainNode.gain.linearRampToValueAtTime(0, start + duration);

        source.start(start);
        this._scheduledSources.push(source);
        this.nextStartTime = start + duration;

        source.onended = () => {
            this._scheduledSources = this._scheduledSources.filter(s => s !== source);
        };
    }

    requestNextPage() {
        if (this.isWaitingForNextPage) return;
        this.isWaitingForNextPage = true;
        document.body.dispatchEvent(new CustomEvent('ReadingOperation', { detail: { action: 'nextPage' } }));
    }
}

window.ZenTTS = ZenTTS;
