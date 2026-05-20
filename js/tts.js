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
        // Visually hide instead of display: none to prevent browsers from suspending it
        this.audioPlayer.style.position = "absolute";
        this.audioPlayer.style.width = "1px";
        this.audioPlayer.style.height = "1px";
        this.audioPlayer.style.opacity = "0";
        this.audioPlayer.style.pointerEvents = "none";
        this.audioPlayer.loop = true;
        this.audioPlayer.src = "s.wav"; // Use static, reliable WAV file (cached by service worker)
        document.body.appendChild(this.audioPlayer);

        const initialEngine = this.app.ttsEngine || 'piper';
        this.switchEngine(initialEngine);

        this.initMediaSession();
    }

    switchEngine(engineType) {
        const wasPlaying = this.isPlaying && !this.isPaused;
        
        // Cancel any active loops immediately
        this._playSessionId++;

        if (this.ttsEngine) {
            this.ttsEngine.destroy();
            this.ttsEngine = null;
        }

        if (engineType === 'webspeech' && window.ZenTTSWebSpeech) {
            this.ttsEngine = new window.ZenTTSWebSpeech(this.app);
            // WebSpeech doesn't need (and conflicts with) the silent HTML5 audio player
            if (this.audioPlayer) {
                this.audioPlayer.pause();
            }
        } else if (window.ZenTTSPiper) {
            this.ttsEngine = new window.ZenTTSPiper(this.app);
        }

        // Old chunks belong to the destroyed engine, discard them
        this.chunks = null;

        // If we switched engines while playing, we need to restart the current page
        if (wasPlaying && this._lastReadingText) {
            this.isPlaying = true;
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
                artwork: [{ src: new URL('icon.svg', window.location.href).href, sizes: '512x512', type: 'image/svg+xml' }]
            });
            navigator.mediaSession.playbackState = this.isPlaying ? 'playing' : (this.isPaused ? 'paused' : 'none');
        }

        // WebSpeech API doesn't need the silent audio loop and playing it can cause focus muting on Android.
        // Only keep the silent audio loop active for non-WebSpeech engines (like Piper).
        if (this.app.ttsEngine !== 'webspeech' && this.isPlaying && this.audioPlayer && this.audioPlayer.paused) {
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
        if (this.app.ttsEngine !== 'webspeech') {
            this.audioPlayer.play().catch(e => console.error(`audioPlayer.play() error: ${e.message}`));
        }
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
        
        // **Critical for iOS/Android**: Must call play() synchronously within the user gesture (click event)
        // to acquire the MediaSession lock screen controls (only for non-WebSpeech engines)!
        if (this.app.ttsEngine !== 'webspeech') {
            this.audioPlayer.play().catch(e => console.warn(`audioPlayer.play() in start: ${e.message}`));
        }

        if (!this.chunks) {
            document.body.dispatchEvent(new CustomEvent('ReadingOperation', { detail: { action: 'requestReadingOver' } }));
        } else {
            this.playCurrentPage();
        }
    }

    async playCurrentPage() {
        if (!this.chunks) return;

        // Ensure the silent audio is playing to keep system awake (only for non-WebSpeech engines)
        if (this.app.ttsEngine !== 'webspeech') {
            this.audioPlayer.play().catch(e => console.error(`audioPlayer.play() error: ${e.message}`));
        }

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

}

window.ZenTTS = ZenTTS;
