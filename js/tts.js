class ZenTTS {
    constructor(app) {
        this.app = app;
        
        // State
        this.isPlaying = false;
        this.sessionId = 0;
        this.currentText = "";
        this.chunks = [];
        this.chunkIndex = 0;
        this.isWaitingForNextPage = false;
        
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

        // Background Keep-Alive Audio
        this.silentAudio = new Audio();
        this.silentAudio.loop = true;
        this.silentAudio.src = "data:audio/wav;base64,UklGRigAAABXQVZFRm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==";
        
        this.initMediaSession();
    }

    initMediaSession() {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.setActionHandler('play', () => this.start());
            navigator.mediaSession.setActionHandler('pause', () => this.stop());
        }
    }

    updateMediaMetadata(chunkText = "") {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: this.app.els.documentTitle.textContent || 'Zen Reader',
                artist: 'Zen Reader TTS',
                album: chunkText || this.currentText.substring(0, 50) + '...',
                artwork: [
                    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }
                ]
            });
            navigator.mediaSession.playbackState = this.isPlaying ? 'playing' : 'paused';
        }
    }

    bindEvents() {
        if (this.els.btnToggle) {
            this.els.btnToggle.addEventListener('click', () => this.toggle());
        }
        if (this.els.speed) {
            this.els.speed.addEventListener('change', (e) => {
                this.app.setTTSSpeed(e.target.value);
                if (this.isPlaying) {
                    // Restart current chunk with new speed
                    this.readCurrentChunk();
                }
            });
        }

        // Listen for visible text from ReadingPanel
        document.body.addEventListener('ReadingOver', (e) => {
            const newText = e.detail.reading;
            if (this.currentText !== newText) {
                // Remember the last read chunk to handle overlap
                const lastFinishedChunk = this.chunks[this.chunkIndex - 1];
                
                this.currentText = newText;
                this.prepareChunks();
                
                // Reset progress and restart if playing
                if (this.isPlaying) {
                    this.isWaitingForNextPage = false;
                    
                    // If the first chunk of the new page is exactly the same as the last chunk we read, skip it.
                    if (lastFinishedChunk && this.chunks[0] === lastFinishedChunk) {
                        this.chunkIndex = 1;
                    } else {
                        this.chunkIndex = 0;
                    }
                    this.readCurrentChunk();
                }
            }
        });
    }

    prepareChunks() {
        // Split by punctuation and original newlines, keeping the delimiters
        this.chunks = this.currentText.split(/([。！？\n])/).reduce((acc, part, i) => {
            if (i % 2 === 0) {
                if (part) acc.push(part);
            } else {
                if (acc.length > 0) acc[acc.length - 1] += part;
                else if (part) acc.push(part);
            }
            return acc;
        }, []).filter(s => s.trim().length > 0);
    }

    toggle() {
        if (this.isPlaying) this.stop();
        else this.start();
    }

    stop() {
        this.isPlaying = false;
        this.sessionId++;
        if (this.els.icon) this.els.icon.textContent = '▶';
        window.speechSynthesis.cancel();

        if (this.silentAudio) this.silentAudio.pause();
        this.updateMediaMetadata();
    }

    start() {
        if (!this.currentText) {
            // If no text, maybe we just opened the book, trigger a render to get text
            this.app.readingPanel.render(); 
        }
        
        this.sessionId++;
        window.speechSynthesis.cancel();
        this.isPlaying = true;
        this.isWaitingForNextPage = false;
        if (this.els.icon) this.els.icon.textContent = '⏸';

        if (this.silentAudio) {
            this.silentAudio.play().catch(e => console.log("Audio play blocked", e));
        }

        this.chunkIndex = 0;
        this.readCurrentChunk();
    }

    readCurrentChunk() {
        if (!this.isPlaying || this.chunkIndex >= this.chunks.length) {
            if (this.isPlaying && this.chunkIndex >= this.chunks.length) {
                // Finished current page, ask for next
                this.requestNextPage();
            }
            return;
        }

        const text = this.chunks[this.chunkIndex];
        const sid = ++this.sessionId;
        window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = this.app.ttsSpeed || 1.0;
        utterance.lang = /[\u4e00-\u9fa5]/.test(text) ? 'zh-TW' : 'en-US';

        utterance.onend = () => {
            if (sid !== this.sessionId || !this.isPlaying) return;
            this.chunkIndex++;
            setTimeout(() => this.readCurrentChunk(), 50);
        };

        utterance.onerror = (e) => {
            if (sid !== this.sessionId || e.error === 'interrupted') return;
            console.error("TTS Error", e);
            this.stop();
        };

        this.updateMediaMetadata(text);
        window.speechSynthesis.speak(utterance);
    }

    requestNextPage() {
        this.isWaitingForNextPage = true;
        document.body.dispatchEvent(new CustomEvent('ReadingOperation', {
            detail: { action: 'nextPage' }
        }));
    }

    // No longer needed: checkVisibility (handled by ReadingOver event)
    checkVisibility() {}
}

window.ZenTTS = ZenTTS;
