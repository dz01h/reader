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

        try {
            const b64 = "SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA/+M4wAAAAAAAAAAAAEluZm8AAAAPAAAAAwAAAbAAqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV////////////////////////////////////////////AAAAAExhdmM1OC4xMwAAAAAAAAAAAAAAACQDkAAAAAAAAAGw9wrNaQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/+MYxAAAAANIAAAAAExBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV/+MYxDsAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV/+MYxHYAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV";
            const binary = atob(b64);
            const array = new Uint8Array(binary.length);
            for(let i = 0; i < binary.length; i++) {
                array[i] = binary.charCodeAt(i);
            }
            const blob = new Blob([array], {type: 'audio/mpeg'});
            this.silentAudio.src = URL.createObjectURL(blob);
            this.silentAudio.load();
        } catch(e) {
            console.error("Failed to create Blob URL for silent audio", e);
            // Fallback to data URI if Blob fails
            this.silentAudio.src = "data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA/+M4wAAAAAAAAAAAAEluZm8AAAAPAAAAAwAAAbAAqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV////////////////////////////////////////////AAAAAExhdmM1OC4xMwAAAAAAAAAAAAAAACQDkAAAAAAAAAGw9wrNaQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/+MYxAAAAANIAAAAAExBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV/+MYxDsAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV/+MYxHYAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV";
            this.silentAudio.load();
        }

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

                // Always update chunkIndex when text changes to point to the start of new text
                if (lastFinishedChunk && lastFinishedChunk.endsWith(this.chunks[0])) {
                    this.chunkIndex = 1;
                } else {
                    this.chunkIndex = 0;
                }

                // Restart if already playing
                if (this.isPlaying) {
                    this.isWaitingForNextPage = false;
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
            this.silentAudio.play().catch(e => {
                console.warn("Silent audio playback failed:", e);
                let errDetails = `${e.name}: ${e.message}`;
                // If it's just a playback block, we can still try to proceed with TTS
                if (e.name === 'NotAllowedError') {
                    this.app.showToast(`TTS: 點擊螢幕允許音訊 (${errDetails})`);
                } else {
                    this.app.showToast(`音訊啟動失敗: ${errDetails}`);
                }
            });
        }

        const voices = window.speechSynthesis.getVoices();
        if (voices.length === 0) {
            this.app.showToast("語音引擎載入中...");
            setTimeout(() => {
                if (this.isPlaying && window.speechSynthesis.getVoices().length === 0) {
                    this.app.showToast("警告：未偵測到系統語音，請確認已安裝或啟用 TTS 引擎。");
                }
            }, 3000);
        } else {
            this.app.showToast("TTS 開始撥放...");
        }

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

        let cleanText = text;

        // Remove punctuation, but keep specific ones for natural pausing
        const keepPunc = /[,，、;；.：:。]/;
        try {
            const puncReg = new RegExp('[\\p{P}\\p{S}]', 'gu');
            cleanText = cleanText.replace(puncReg, match => keepPunc.test(match) ? match : '').trim();
        } catch (e) {
            // Fallback if browser doesn't support unicode property escapes
            cleanText = cleanText.replace(/[!?'"()[\]{}<>\-=_+*&^%$#@~`\\/|！？「」『』（）〔〕【】《》〈〉～—…・]/g, '');
        }

        const utterance = new SpeechSynthesisUtterance(cleanText);
        utterance.rate = this.app.ttsSpeed || 1.0;
        utterance.lang = /[\u4e00-\u9fa5]/.test(cleanText) ? 'zh-TW' : 'en-US';

        utterance.onstart = () => {
            console.log("TTS started:", text.substring(0, 20));
        };

        utterance.onend = () => {
            if (sid !== this.sessionId || !this.isPlaying) return;
            this.chunkIndex++;
            setTimeout(() => this.readCurrentChunk(), 50);
        };

        utterance.onerror = (e) => {
            if (sid !== this.sessionId) return;
            if (e.error === 'interrupted') {
                console.log("TTS interrupted (normal)");
                return;
            }
            console.error("TTS Error Detail:", e.error, e.message, e);
            this.app.showToast(`TTS Error: ${e.error}`);
            this.stop();
        };

        this.updateMediaMetadata(text);

        const voices = window.speechSynthesis.getVoices();
        if (sid === 1) {
            console.log("Available voices:", voices.length);
        }

        if (voices.length > 0) {
            window.speechSynthesis.speak(utterance);
        } else {
            // Some devices need a moment or an event to load voices
            let hasSpoken = false;

            const speakNow = () => {
                if (!hasSpoken && this.isPlaying && sid === this.sessionId) {
                    hasSpoken = true;
                    window.speechSynthesis.onvoiceschanged = null;
                    window.speechSynthesis.speak(utterance);
                }
            };

            window.speechSynthesis.onvoiceschanged = speakNow;

            // Android WebView sometimes never fires onvoiceschanged until you actually try to speak.
            // Give it a short delay and force speak to trigger the engine.
            setTimeout(speakNow, 800);
        }
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
