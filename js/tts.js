class ZenTTS {
    constructor(app) {
        this.app = app;

        this.isPlaying = false;
        this.isPaused = false;
        this.isWaitingForNextPage = false;
        
        this.chunks = null;
        this.ttsEngine = null;
        this._lastReadingText = null;
        this._playSessionId = 0; // Used to cancel older loops when turning pages

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

        // Silent audio player to keep OS awake and bind MediaSession
        this.audioPlayer = new Audio();
        this.audioPlayer.id = "tts-master-player";
        this.audioPlayer.style.display = "none";
        this.audioPlayer.loop = true;
        this.audioPlayer.src = this._createSilentAudioURL(1);
        document.body.appendChild(this.audioPlayer);

        const initialEngine = this.app.ttsEngine || 'piper';
        this.switchEngine(initialEngine);

        this.initMediaSession();
    }

    switchEngine(engineType) {
        const wasPlaying = this.isPlaying && !this.isPaused;
        
        if (this.ttsEngine) {
            this.ttsEngine.destroy();
            this.ttsEngine = null;
        }

        if (engineType === 'webspeech' && window.ZenTTSWebSpeech) {
            this.ttsEngine = new window.ZenTTSWebSpeech(this.app);
        } else if (engineType === 'matcha' && window.ZenTTSMatcha) {
            this.ttsEngine = new window.ZenTTSMatcha(this.app);
        }

        // If we switched engines while playing, we need to restart the current page
        if (wasPlaying && this._lastReadingText) {
            this.isPlaying = true;
            this.chunks = null; // force re-prepare
            document.body.dispatchEvent(new CustomEvent('ReadingOperation', { detail: { action: 'requestReadingOver' } }));
        }
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

        // WebSpeech API might cause the OS to duck or pause HTML5 audio.
        // We must forcefully keep the silent audio loop alive to retain lock screen controls.
        if (this.isPlaying && this.audioPlayer && this.audioPlayer.paused) {
            this.audioPlayer.play().catch(e => console.warn('Silent audio play blocked:', e));
        }
    }

    bindEvents() {
        if (this.els.btnToggle) this.els.btnToggle.addEventListener('click', () => this.toggle());
        if (this.els.speed) {
            this.els.speed.addEventListener('change', (e) => {
                this.app.setTTSSpeed(parseFloat(e.target.value));
            });
        }

        document.body.addEventListener('ReadingOver', (e) => {
            const readingData = e.detail;
            const textChanged = readingData.reading !== this._lastReadingText;

            if (!this.ttsEngine) return;

            // When NOT actively playing or paused (meaning TTS is completely stopped),
            // do not call prepare or start workers to save battery.
            if (!this.isPlaying && !this.isPaused) {
                this.chunks = null;
                this._lastReadingText = readingData.reading;
                return;
            }

            if (this.isWaitingForNextPage) {
                // Auto page turn (TTS triggered)
                this.isWaitingForNextPage = false;
                this._lastReadingText = readingData.reading;
                this.chunks = this.ttsEngine.prepare(readingData);
                
                if (this.isPlaying) {
                    this.playCurrentPage();
                }
            } else if (textChanged || !this.chunks) {
                // Manual page turn, jump, or starting play for the first time
                this._lastReadingText = readingData.reading;

                if (textChanged) {
                    // Page changed while TTS was active — stop old audio, but don't kill workers
                    this.ttsEngine.stopAudio(false);
                }

                this.chunks = this.ttsEngine.prepare(readingData);

                this.isPlaying = true;
                this.isPaused = false;
                this.playCurrentPage();
            }
            // else: same page re-render with existing chunks — keep the current loop running, no action needed
        });

        // Listen for ChunkPlaying event to update metadata
        document.body.addEventListener('ZenTTS:ChunkPlaying', (e) => {
            this.updateMediaMetadata(e.detail.text);
        });
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
        
        if (this.ttsEngine && this.ttsEngine.suspendAudio) {
            this.ttsEngine.suspendAudio();
        }
        this.audioPlayer.pause();
        this.updateMediaMetadata();
    }

    resume() {
        if (!this.isPaused) return;
        this.isPlaying = true;
        this.isPaused = false;
        
        if (this.els.icon) this.els.icon.textContent = '⏸';
        
        if (this.ttsEngine && this.ttsEngine.resumeAudio) {
            this.ttsEngine.resumeAudio();
        }
        this.audioPlayer.play().catch(e => console.error(`audioPlayer.play() error: ${e.message}`));
        this.updateMediaMetadata();
    }

    stop() {
        this.isPlaying = false;
        this.isPaused = false;
        this._playSessionId++; // Cancel active loop
        if (this.els.icon) this.els.icon.textContent = '▶';

        if (this.ttsEngine && this.ttsEngine.stopAudio) {
            this.ttsEngine.stopAudio(false); 
        }
        this.audioPlayer.pause();
        this.updateMediaMetadata();
    }

    async start() {
        this.isPlaying = true;
        this.isPaused = false;
        this.isWaitingForNextPage = false;
        if (this.els.icon) this.els.icon.textContent = '⏸';
        
        if (!this.chunks) {
            document.body.dispatchEvent(new CustomEvent('ReadingOperation', { detail: { action: 'requestReadingOver' } }));
        } else {
            this.playCurrentPage();
        }
    }

    async playCurrentPage() {
        if (!this.chunks) return;

        // Ensure the silent audio is playing to keep system awake
        this.audioPlayer.play().catch(e => console.error(`audioPlayer.play() error: ${e.message}`));

        const sessionId = ++this._playSessionId;
        const currentChunks = this.chunks;

        while (this.isPlaying && this._playSessionId === sessionId && currentChunks.hasNext()) {
            await currentChunks.speak();
        }

        // If the loop finished naturally (reached end of page, not interrupted)
        if (this.isPlaying && this._playSessionId === sessionId) {
            this.requestNextPage();
        }
    }

    requestNextPage() {
        if (this.isWaitingForNextPage) return;
        this.isWaitingForNextPage = true;
        document.body.dispatchEvent(new CustomEvent('ReadingOperation', { detail: { action: 'nextPage' } }));
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
}

window.ZenTTS = ZenTTS;
