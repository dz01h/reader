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
        
        // Web Audio State (for gapless playback)
        this.audioCtx = null;
        this.nextScheduleTime = 0;
        
        // Queue State
        this.synthesisQueue = new Map(); // chunkIndex -> Blob
        this.isSynthesizing = false;
        this.heartbeatInterval = null;

        this.initDOM();
        this.bindEvents();
        this.debugLog("TTS initialized (Gapless Web Audio ready)");
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

        // Long Silent Audio (Master for Media Session)
        // Using a 10-minute silent base to satisfy the "long audio" requirement for MediaSession panel
        this.silentAudio = new Audio();
        this.silentAudio.loop = true;
        try {
            // Generating a data URI for a longer silent MP3 (10 seconds base, will loop)
            // This is a minimal valid silent MP3 frame repeated
            const silentB64 = "SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA/+M4wAAAAAAAAAAAAEluZm8AAAAPAAAAAwAAAbAAqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV////////////////////////////////////////////AAAAAExhdmM1OC4xMwAAAAAAAAAAAAAAACQDkAAAAAAAAAGw9wrNaQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/+MYxAAAAANIAAAAAExBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV/+MYxDsAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV/+MYxHYAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV";
            const binary = atob(silentB64);
            const array = new Uint8Array(binary.length);
            for(let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
            const blob = new Blob([array], {type: 'audio/mpeg'});
            this.silentAudio.src = URL.createObjectURL(blob);
            this.silentAudio.volume = 0.001; // Extremely low but not muted to keep session alive
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
        
        if (this.audioCtx) {
            this.audioCtx.close().catch(() => {});
            this.audioCtx = null;
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
        
        // Initialize Web Audio Context on user gesture
        if (!this.audioCtx) {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            this.nextScheduleTime = this.audioCtx.currentTime;
        }
        
        if (this.silentAudio) this.silentAudio.play().catch(() => {});
        this.requestWakeLock();
        this.startHeartbeat();
        this.readCurrentChunk();
    }

    startHeartbeat() {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = setInterval(() => {
            if (this.isPlaying) {
                this.fillQueue(this.sessionId);
                // Monitor scheduling to handle page jumps or stalls
                if (this.audioCtx && this.audioCtx.currentTime > this.nextScheduleTime + 2) {
                    this.nextScheduleTime = this.audioCtx.currentTime;
                }
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
            this.scheduleAudioBlob(blob, sid, this.chunkIndex);
            return;
        }

        const blob = await this.synthesizeChunk(this.chunkIndex, sid);
        if (blob && sid === this.sessionId && this.isPlaying) {
            this.scheduleAudioBlob(blob, sid, this.chunkIndex);
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
            for (let i = 1; i <= 5; i++) {
                const nextIdx = this.chunkIndex + i;
                if (nextIdx < this.chunks.length && !this.synthesisQueue.has(nextIdx)) {
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

    async scheduleAudioBlob(blob, sid, idx) {
        if (!this.audioCtx || sid !== this.sessionId || !this.isPlaying) return;

        try {
            const arrayBuffer = await blob.arrayBuffer();
            const audioBuffer = await this.audioCtx.decodeAudioData(arrayBuffer);
            
            if (sid !== this.sessionId || !this.isPlaying) return;

            const source = this.audioCtx.createBufferSource();
            source.buffer = audioBuffer;
            source.playbackRate.value = this.app.ttsSpeed || 1.0;
            source.connect(this.audioCtx.destination);
            
            // Scheduling logic
            const startTime = Math.max(this.audioCtx.currentTime, this.nextScheduleTime);
            source.start(startTime);
            
            const duration = audioBuffer.duration / (this.app.ttsSpeed || 1.0);
            this.nextScheduleTime = startTime + duration;

            // When this buffer finishes, trigger next chunk logic
            source.onended = () => {
                if (sid !== this.sessionId || !this.isPlaying) return;
                // Only increment chunkIndex if we finished the one we just played
                if (this.chunkIndex === idx) {
                    this.chunkIndex++;
                    this.readCurrentChunk();
                }
            };

            this.updateMediaMetadata(this.chunks[idx]);
            this.fillQueue(sid);
        } catch (e) {
            this.debugLog(`Scheduling error: ${e.message}`);
            this.chunkIndex++;
            this.readCurrentChunk();
        }
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
