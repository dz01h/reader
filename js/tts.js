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
        
        // Offline Engine State
        this.engines = {}; 
        this.converter = null;
        this.isModelLoaded = false;
        
        // Queue State
        this.synthesisQueue = new Map(); // chunkIndex -> Blob
        this.isSynthesizing = false;
        this.heartbeatInterval = null;

        this.initDOM();
        this.bindEvents();
        this.debugLog("TTS initialized (Offline Engine with Background Keep-Alive ready)");
    }

    debugLog(msg) {
        const timestamp = new Date().toLocaleTimeString();
        const fullMsg = `[${timestamp}] ${msg}`;
        console.log(fullMsg);
        
        let logs = JSON.parse(localStorage.getItem('zen_tts_debug_log') || '[]');
        logs.push(fullMsg);
        if (logs.length > 50) logs.shift();
        localStorage.setItem('zen_tts_debug_log', JSON.stringify(logs));
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

        this.silentAudio = new Audio();
        this.silentAudio.loop = true;
        try {
            const b64 = "SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA/+M4wAAAAAAAAAAAAEluZm8AAAAPAAAAAwAAAbAAqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV////////////////////////////////////////////AAAAAExhdmM1OC4xMwAAAAAAAAAAAAAAACQDkAAAAAAAAAGw9wrNaQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/+MYxAAAAANIAAAAAExBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV/+MYxDsAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV/+MYxHYAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV";
            const binary = atob(b64);
            const array = new Uint8Array(binary.length);
            for(let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
            const blob = new Blob([array], {type: 'audio/mpeg'});
            this.silentAudio.src = URL.createObjectURL(blob);
            this.silentAudio.volume = 0.01;
            document.body.appendChild(this.silentAudio);
        } catch(e) {}

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
                album: chunkText || this.currentText.substring(0, 50) + '...',
                artwork: [{ src: 'icon.svg', sizes: '512x512', type: 'image/svg+xml' }]
            });
            navigator.mediaSession.playbackState = this.isPlaying ? 'playing' : 'paused';
        }
    }

    bindEvents() {
        if (this.els.btnToggle) this.els.btnToggle.addEventListener('click', () => this.toggle());
        if (this.els.speed) {
            this.els.speed.addEventListener('change', (e) => {
                this.app.setTTSSpeed(e.target.value);
            });
        }

        document.body.addEventListener('ReadingOver', (e) => {
            const newText = e.detail.reading;
            if (this.currentText !== newText) {
                this.currentText = newText;
                this.prepareChunks();
                this.chunkIndex = 0;
                this.synthesisQueue.clear();
                if (this.isPlaying) {
                    this.isWaitingForNextPage = false;
                    this.readCurrentChunk();
                }
            }
        });
    }

    prepareChunks() {
        // Updated regex to split on more punctuation for better intonation
        this.chunks = this.currentText.split(/([。！？\n，、；：])/).reduce((acc, part, i) => {
            if (i % 2 === 0) { if (part) acc.push(part); }
            else { if (acc.length > 0) acc[acc.length - 1] += part; else if (part) acc.push(part); }
            return acc;
        }, []).filter(s => s.trim().length > 0);
    }

    async initEngine(lang) {
        if (!window.VITSWeb) return null;
        const modelMap = {
            'zh-TW': this.app.ttsVoice || 'zh_CN-huayan-medium',
            'en': 'en_US-hfc_female-medium',
            'ja': 'ja_JP-jvnv-medium'
        };
        const modelId = modelMap[lang] || modelMap['en'];
        if (lang === 'zh-TW' && !this.converter && window.OpenCC) {
            this.converter = window.OpenCC.Converter({ from: 'tw', to: 'cn' });
        }
        return modelId;
    }

    toggle() {
        if (this.isPlaying) this.stop();
        else this.start();
    }

    stop() {
        this.isPlaying = false;
        this.sessionId++;
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        if (this.els.icon) this.els.icon.textContent = '▶';
        if (this.currentAudio) {
            this.currentAudio.pause();
            URL.revokeObjectURL(this.currentAudio.src);
            this.currentAudio = null;
        }
        this.synthesisQueue.clear();
        if (this.silentAudio) this.silentAudio.pause();
        this.updateMediaMetadata();
    }

    async start() {
        if (!this.currentText) this.app.readingPanel.render();
        this.sessionId++;
        this.isPlaying = true;
        this.isWaitingForNextPage = false;
        if (this.els.icon) this.els.icon.textContent = '⏸';
        if (this.silentAudio) this.silentAudio.play().catch(() => {});
        this.requestWakeLock();
        this.startHeartbeat();
        this.readCurrentChunk();
    }

    startHeartbeat() {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = setInterval(() => {
            if (this.isPlaying) {
                // Keep JS active and refill queue
                this.fillQueue(this.sessionId);
            }
        }, 1000);
    }

    async readCurrentChunk() {
        if (!this.isPlaying || this.chunkIndex >= this.chunks.length) {
            if (this.isPlaying && this.chunkIndex >= this.chunks.length) this.requestNextPage();
            return;
        }

        const sid = this.sessionId;

        if (this.synthesisQueue.has(this.chunkIndex)) {
            const blob = this.synthesisQueue.get(this.chunkIndex);
            this.synthesisQueue.delete(this.chunkIndex); 
            this.playAudioBlob(blob, sid);
            return;
        }

        const blob = await this.synthesizeChunk(this.chunkIndex, sid);
        if (blob && sid === this.sessionId && this.isPlaying) {
            this.playAudioBlob(blob, sid);
        }
    }

    async synthesizeChunk(idx, sid) {
        if (idx >= this.chunks.length) return null;
        const text = this.chunks[idx];
        const lang = /[\u3040-\u309F\u30A0-\u30FF]/.test(text) ? 'ja' : 
                     (/[\u4e00-\u9fa5]/.test(text) ? 'zh-TW' : 'en');

        const modelId = await this.initEngine(lang);
        if (!modelId || sid !== this.sessionId) return null;

        let inputPath = text;
        if (lang === 'zh-TW' && this.converter) inputPath = this.converter(text);

        try {
            if (idx === 0 && !this.isModelLoaded) {
                this.app.showToast("正在載入離線模型並合成語音...");
            }
            const wavBlob = await window.VITSWeb.predict({ text: inputPath, voiceId: modelId });
            this.isModelLoaded = true;
            return wavBlob;
        } catch (e) {
            this.debugLog(`Synthesis error [${idx}]: ${e.message}`);
            return null;
        }
    }

    async fillQueue(sid) {
        if (this.isSynthesizing || !this.isPlaying || sid !== this.sessionId) return;
        this.isSynthesizing = true;

        try {
            // Increased look-ahead to 5 chunks for better background resilience
            for (let i = 1; i <= 5; i++) {
                const nextIdx = this.chunkIndex + i;
                if (nextIdx < this.chunks.length && !this.synthesisQueue.has(nextIdx)) {
                    this.debugLog(`Pre-synthesizing chunk ${nextIdx}`);
                    const blob = await this.synthesizeChunk(nextIdx, sid);
                    if (blob && sid === this.sessionId) {
                        this.synthesisQueue.set(nextIdx, blob);
                    } else if (sid !== this.sessionId) {
                        break;
                    }
                }
            }
        } finally {
            this.isSynthesizing = false;
        }
    }

    playAudioBlob(blob, sid) {
        if (this.currentAudio) {
            this.currentAudio.pause();
            URL.revokeObjectURL(this.currentAudio.src);
            this.currentAudio = null;
        }

        const url = URL.createObjectURL(blob);
        this.currentAudio = new Audio(url);
        this.currentAudio.playbackRate = this.app.ttsSpeed || 1.0;
        
        this.currentAudio.onplay = () => {
            this.fillQueue(sid);
        };

        this.currentAudio.onended = () => {
            if (sid !== this.sessionId || !this.isPlaying) return;
            this.chunkIndex++;
            this.readCurrentChunk();
        };

        this.currentAudio.onerror = () => {
            if (sid !== this.sessionId) return;
            this.chunkIndex++;
            setTimeout(() => this.readCurrentChunk(), 100);
        };

        this.updateMediaMetadata(this.chunks[this.chunkIndex]);
        this.currentAudio.play().catch(e => {
            this.app.showToast(`音訊播放失敗: ${e.message}`);
            this.stop();
        });
    }

    async requestWakeLock() {
        if ('wakeLock' in navigator) {
            try { this.wakeLock = await navigator.wakeLock.request('screen'); } catch (err) {}
        }
    }

    requestNextPage() {
        this.isWaitingForNextPage = true;
        document.body.dispatchEvent(new CustomEvent('ReadingOperation', { detail: { action: 'nextPage' } }));
    }
}

window.ZenTTS = ZenTTS;
