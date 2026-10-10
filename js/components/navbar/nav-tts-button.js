/**
 * Audio Buffer Pool sorted by character index
 * Keeps prefetched / computed audio tokens and discards oldest when size > 100
 */
class TokenAudioBufferPool {
    constructor(maxSize = 100) {
        this.maxSize = maxSize;
        this.pool = new Map(); // key: charIndex -> { token, status: 'pending'|'ready', audioData: any }
    }

    has(charIndex) {
        return this.pool.has(charIndex);
    }

    get(charIndex) {
        return this.pool.get(charIndex);
    }

    set(charIndex, item) {
        this.pool.set(charIndex, item);
        if (this.pool.size > this.maxSize) {
            this.cleanup(charIndex);
        }
    }

    /**
     * Clean up tokens when buffer size exceeds maxSize
     * Prefers removing already played tokens (endCharIndex <= currentCharIndex)
     * If still over capacity, removes lowest charIndex (oldest) items
     * @param {number} currentCharIndex 
     */
    cleanup(currentCharIndex = 0) {
        if (this.pool.size <= this.maxSize) return;

        // 1. First pass: remove played tokens
        const sortedKeys = Array.from(this.pool.keys()).sort((a, b) => a - b);
        for (const key of sortedKeys) {
            if (this.pool.size <= this.maxSize) break;
            const item = this.pool.get(key);
            if (item?.token?.endCharIndex !== undefined && item.token.endCharIndex <= currentCharIndex) {
                this.pool.delete(key);
            } else if (key < currentCharIndex) {
                this.pool.delete(key);
            }
        }

        // 2. Second pass: if still > maxSize, remove oldest keys (lowest charIndex)
        if (this.pool.size > this.maxSize) {
            const remainingKeys = Array.from(this.pool.keys()).sort((a, b) => a - b);
            while (this.pool.size > this.maxSize && remainingKeys.length > 0) {
                const oldestKey = remainingKeys.shift();
                this.pool.delete(oldestKey);
            }
        }
    }

    clear() {
        this.pool.clear();
    }
}

/**
 * NavTtsButton
 * Web Component extending ActionButton to control TTS playback.
 * Self-contained: manages audio player, wake lock, media session, engine switching,
 * parses visible sentences with character position tracking on ReadingPanelRenderOver,
 * and dispatches SpeachOver / SpeechOver / TTSEvent events to coordinate automatic page turns.
 */
class NavTtsButton extends (window.ActionButton || window.Component || HTMLElement) {
    constructor() {
        super();

        this.isPlaying = false;
        this.isPaused = false;
        this.isSpeaking = false;

        this.queue = [];
        this.spokenCharIndices = new Set();
        this.currentSessionId = 0;
        this.lastRenderData = null;
        this._currentPageStartOffset = null;
        this.currentPlayingToken = null;
        this.currentPlayingCharIndex = null;
        this.bufferPool = new TokenAudioBufferPool(100);

        this.ttsEngine = null;
        this.audioPlayer = null;
        this.wakeLock = null;

        this.initComponent();
    }

    initComponent() {
        if (typeof super.initComponent === 'function') {
            super.initComponent();
        }

        this.classList.add('nav-tts-button');
        if (!this.hasAttribute('role')) {
            this.setAttribute('role', 'button');
        }
        if (!this.hasAttribute('title')) {
            this.setAttribute('title', '語音朗讀 (TTS)');
        }

        // If icon span doesn't exist, create it
        let icon = this.querySelector('#tts-icon');
        if (!icon) {
            icon = document.createElement('span');
            icon.id = 'tts-icon';
            icon.textContent = '▶';
            this.appendChild(icon);
        }
        this.iconEl = icon;

        this.initAudioPlayer();
        this.initMediaSession();
        this.initWakeLock();

        const initialEngine = window._app?.ttsEngine || 'webspeech';
        this.switchEngine(initialEngine);

        this.mountEvents();
    }

    initAudioPlayer() {
        if (this.audioPlayer) return;
        this.audioPlayer = new Audio();
        this.audioPlayer.id = 'tts-master-player';
        this.audioPlayer.style.position = 'absolute';
        this.audioPlayer.style.width = '1px';
        this.audioPlayer.style.height = '1px';
        this.audioPlayer.style.opacity = '0';
        this.audioPlayer.style.pointerEvents = 'none';
        this.audioPlayer.loop = true;
        this.audioPlayer.src = this._createSilentAudioURL(15);
        document.body.appendChild(this.audioPlayer);
    }

    _createSilentAudioURL(seconds) {
        const sampleRate = 22050;
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

    updateMediaMetadata(chunkText = '') {
        if ('mediaSession' in navigator) {
            const docTitle = window._app?.currentBook?.title || window._app?.currentBook?.filename || 'Zen Reader';
            navigator.mediaSession.metadata = new MediaMetadata({
                title: docTitle,
                artist: 'Offline AI TTS',
                album: chunkText || '朗讀中...',
                artwork: [{ src: new URL('icon.svg', window.location.href).href, sizes: '512x512', type: 'image/svg+xml' }]
            });
            navigator.mediaSession.playbackState = this.isPlaying ? 'playing' : (this.isPaused ? 'paused' : 'none');
        }

        if (this.isPlaying && this.audioPlayer && this.audioPlayer.paused) {
            this.audioPlayer.play().catch(e => console.warn('Silent audio play blocked:', e));
        }
    }

    initWakeLock() {
        this.wakeLock = null;
        this._handleVisibilityChange = async () => {
            if (this.wakeLock !== null && document.visibilityState === 'visible') {
                await this.acquireWakeLock();
            }
        };
    }

    async acquireWakeLock() {
        if ('wakeLock' in navigator && !this.wakeLock) {
            try {
                this.wakeLock = await navigator.wakeLock.request('screen');
                document.addEventListener('visibilitychange', this._handleVisibilityChange);
            } catch (err) {
                console.warn(`Failed to acquire Wake Lock: ${err.message}`);
            }
        }
    }

    async releaseWakeLock() {
        if (this.wakeLock) {
            try {
                await this.wakeLock.release();
                this.wakeLock = null;
            } catch (err) {
                console.warn(`Failed to release Wake Lock: ${err.message}`);
            }
            document.removeEventListener('visibilitychange', this._handleVisibilityChange);
        }
    }

    switchEngine(engineType) {
        if (!engineType || (engineType !== 'webspeech' && engineType !== 'matcha')) {
            engineType = 'webspeech';
        }
        if (this.ttsEngine && this.currentEngineType === engineType) {
            return;
        }
        this.currentEngineType = engineType;
        const wasPlaying = this.isPlaying && !this.isPaused;
        this.currentSessionId++;

        if (this.ttsEngine && typeof this.ttsEngine.destroy === 'function') {
            this.ttsEngine.destroy();
            this.ttsEngine = null;
        }

        const app = window._app || {};
        if (engineType === 'webspeech' && window.ZenTTSWebSpeech) {
            this.ttsEngine = new window.ZenTTSWebSpeech(app);
        } else if (engineType === 'matcha' && window.ZenTTSMatcha) {
            this.ttsEngine = new window.ZenTTSMatcha(app);
        } else if (window.ZenTTSWebSpeech) {
            this.ttsEngine = new window.ZenTTSWebSpeech(app);
        }

        console.log(`[NavTtsButton] TTS engine switched to: ${engineType}`);

        if (wasPlaying) {
            this.start();
        }
    }

    setTTSSpeed(val) {
        if (this.ttsEngine && typeof this.ttsEngine.setTTSSpeed === 'function') {
            this.ttsEngine.setTTSSpeed(val);
        }
    }

    setTTSVoice(val) {
        if (this.ttsEngine && typeof this.ttsEngine.setTTSVoice === 'function') {
            this.ttsEngine.setTTSVoice(val);
        }
        if (this.isPlaying) {
            this.currentSessionId++;
            this.processQueue();
        }
    }

    setTTSModel(engine, voice) {
        this.switchEngine(engine);
    }

    triggerAction() {
        if (this.hasAttribute('disabled')) return;
        this.toggle();
        this.fireEvent('ActionPerformed', { action: this.getAttribute('action') || 'toggleTTS' }, Component.FLAG_EVENT_POPUP | Component.FLAG_EVENT_SYNC);
    }

    mountEvents() {
        // Listen for ReadingPanelRenderOver to obtain visible page text and char positions
        document.body.addEventListener('ReadingPanelRenderOver', (e) => {
            if (e.detail) {
                this.onRenderOver(e.detail);
            }
        });

        // Listen for settingUpdated from SettingPanel to switch engine, voice, or speed
        document.body.addEventListener('settingUpdated', (e) => {
            const field = e.detail?.field;
            const value = e.detail?.value;
            if (field === 'ttsEngine' || field === 'ttsModel') {
                if (value && value !== this.currentEngineType) {
                    this.switchEngine(value);
                }
            } else if (field === 'ttsSpeed') {
                this.setTTSSpeed(value);
            } else if (field === 'ttsVoice') {
                this.setTTSVoice(value);
            }
        });

        // Listen for ReadingOperation to reset or handle external actions
        document.body.addEventListener('ReadingOperation', (e) => {
            const action = e.detail?.action;
            if (action === 'reset') {
                this.stop();
            } else if (action === 'toggleTTS' || action === 'toggle-tts') {
                this.toggle();
            }
        });

        // Listen for ActionPerformed from action-buttons or external sources
        document.body.addEventListener('ActionPerformed', (e) => {
            const action = e.detail?.action;
            if ((action === 'toggleTTS' || action === 'toggle-tts' || action === 'btn-tts-toggle') && e.target !== this) {
                this.toggle();
            }
        });
    }

    /**
     * Assemble lines starting from zeroIndex across line breaks and split into tokens by punctuation.
     * Each token tracks exact character document positions for every character.
     * @param {Object} renderData 
     * @returns {Array<{ tokenIndex: number, text: string, rawText: string, charIndex: number, endCharIndex: number, lineIndex: number, chars: Array<{ char: string, charIndex: number, lineIndex: number }> }>}
     */
    assembleTokens(renderData) {
        if (!renderData || !renderData.lines || renderData.lines.length === 0) return [];

        const lines = renderData.lines;
        const lineIndexs = renderData.lineIndexs || [];
        const zeroIndex = renderData.zeroIndex || 0;
        const linesPerPage = renderData.linesPerPage || 15;
        // Collect current page lines plus lookahead for prefetching
        const maxLine = Math.min(lines.length - 1, zeroIndex + linesPerPage * 2);

        const allChars = [];
        for (let i = zeroIndex; i <= maxLine; i++) {
            const lineText = lines[i] || '';
            const lineStart = (lineIndexs && lineIndexs[i] !== undefined)
                ? lineIndexs[i]
                : (allChars.length > 0 ? allChars[allChars.length - 1].charIndex + 1 : 0);

            for (let j = 0; j < lineText.length; j++) {
                allChars.push({
                    char: lineText[j],
                    charIndex: lineStart + j,
                    lineIndex: i
                });
            }
        }

        if (allChars.length === 0) return [];

        // Punctuation characters to split on
        const punctRegex = /[，。、；：！？－—…\n\r\t,.!?;:()（）《》「」『』"“”'’]/;
        const tokens = [];
        let currentChars = [];

        const flushToken = () => {
            if (currentChars.length === 0) return;

            // Spoken text without punctuation or whitespace
            const spokenChars = currentChars.filter(c => !punctRegex.test(c.char) && c.char.trim().length > 0);
            const text = spokenChars.map(c => c.char).join('');
            const rawText = currentChars.map(c => c.char).join('');

            if (text.length > 0) {
                const first = spokenChars[0];
                tokens.push({
                    tokenIndex: tokens.length,
                    text: text,
                    rawText: rawText,
                    charIndex: first.charIndex,
                    endCharIndex: currentChars[currentChars.length - 1].charIndex + 1,
                    lineIndex: first.lineIndex,
                    chars: spokenChars
                });
            }
            currentChars = [];
        };

        for (let k = 0; k < allChars.length; k++) {
            const cObj = allChars[k];
            currentChars.push(cObj);

            // Split when punctuation is encountered, or safety split if token gets too long
            if (punctRegex.test(cObj.char) || currentChars.length >= 60 || (currentChars.length >= 30 && /\s/.test(cObj.char))) {
                flushToken();
            }
        }
        flushToken();

        return tokens;
    }

    /**
     * Load tokens for the page and lookahead from renderData.
     * Prefetches audio into bufferPool for tokens not yet cached.
     * @param {Object} renderData 
     * @param {boolean} reset Whether to clear queue before loading
     * @returns {Array} Array of token objects
     */
    loadPageSentences(renderData, reset = true) {
        if (!renderData || !renderData.lines || renderData.lines.length === 0) return [];

        const lineIndexs = renderData.lineIndexs || [];
        const zeroIndex = renderData.zeroIndex || 0;
        const currentStartOffset = lineIndexs[zeroIndex] ?? 0;
        this._currentPageStartOffset = currentStartOffset;

        if (reset) {
            this.queue = [];
            this.spokenCharIndices.clear();
        }

        const tokens = this.assembleTokens(renderData);
        const newTokens = [];

        for (const token of tokens) {
            // Register and prefetch in bufferPool if not present
            if (!this.bufferPool.has(token.charIndex)) {
                const bufferItem = {
                    token,
                    status: 'pending',
                    audioData: null
                };
                this.bufferPool.set(token.charIndex, bufferItem);

                // Prefetch audio in background if engine supports prefetchSentence
                if (this.ttsEngine && typeof this.ttsEngine.prefetchSentence === 'function') {
                    this.ttsEngine.prefetchSentence(token.text).then(audioData => {
                        bufferItem.status = 'ready';
                        bufferItem.audioData = audioData;
                    }).catch(err => {
                        console.warn('[NavTtsButton] Prefetch error for:', token.text, err);
                    });
                }
            }

            // Queue token for playback if not already spoken and not already in queue
            if (!this.spokenCharIndices.has(token.charIndex)) {
                if (!this.queue.some(q => q.charIndex === token.charIndex)) {
                    newTokens.push(token);
                }
            }
        }

        this.queue.push(...newTokens);
        console.log(`[NavTtsButton] Loaded ${newTokens.length} tokens into queue (bufferPool size: ${this.bufferPool.pool.size})`);
        return newTokens;
    }

    /**
     * Handle ReadingPanelRenderOver event data
     * Synchronizes current page text when playing or page changes
     * @param {Object} renderData 
     */
    onRenderOver(renderData) {
        this.lastRenderData = renderData;

        if (!renderData || !renderData.lines || renderData.lines.length === 0) return;

        // If TTS is NOT active, keep queue clean to avoid stale buffering
        if (!this.isPlaying || this.isPaused) {
            this.queue = [];
            return;
        }

        const lineIndexs = renderData.lineIndexs || [];
        const zeroIndex = renderData.zeroIndex || 0;
        const currentStartOffset = lineIndexs[zeroIndex] ?? 0;

        // If the page has changed (auto page turn or user manual navigation)
        if (this._currentPageStartOffset === null || this._currentPageStartOffset !== currentStartOffset) {
            const prevOffset = this._currentPageStartOffset;
            this._currentPageStartOffset = currentStartOffset;

            // Check if this is a natural sequential page turn or an external manual jump
            const isNaturalPageTurn = this.isSpeaking && (
                (this.currentPlayingToken && Math.abs(currentStartOffset - this.currentPlayingToken.endCharIndex) < 50) ||
                (this.currentPlayingCharIndex !== null && Math.abs(currentStartOffset - this.currentPlayingCharIndex) < 50)
            );

            if (isNaturalPageTurn) {
                console.log(`[NavTtsButton] Natural page turn to offset ${currentStartOffset}. Appending next page tokens...`);
                this.loadPageSentences(renderData, false);
                if (!this.isSpeaking) {
                    this.processQueue();
                }
            } else {
                console.log(`[NavTtsButton] Manual navigation detected (from ${prevOffset} to ${currentStartOffset}). Resetting queue...`);
                this.currentSessionId++;
                if (this.ttsEngine && typeof this.ttsEngine.stopAudio === 'function') {
                    this.ttsEngine.stopAudio(false);
                }
                this.loadPageSentences(renderData, true);
                this.processQueue();
            }
        }
    }

    toggle() {
        if (this.isPlaying && !this.isPaused) {
            this.pause();
        } else if (this.isPaused) {
            this.resume();
        } else {
            this.start();
        }
    }

    start() {
        this.isPlaying = true;
        this.isPaused = false;
        this.currentSessionId++;
        this.updateUI();

        if (this.audioPlayer) {
            this.audioPlayer.play().catch(e => console.warn('Silent audio play blocked:', e));
        }
        this.acquireWakeLock();
        this.updateMediaMetadata();

        // Use lastRenderData received from ReadingPanelRenderOver event
        if (this.lastRenderData) {
            this.loadPageSentences(this.lastRenderData, true);
            this.processQueue();
        } else {
            // Request reading panel to render and broadcast ReadingPanelRenderOver
            this.fireEvent('ReadingOperation', {
                action: 'render',
                params: [true]
            }, Component.FLAG_EVENT_POPUP | Component.FLAG_EVENT_SYNC);
        }
    }

    pause() {
        if (!this.isPlaying) return;
        this.isPlaying = false;
        this.isPaused = true;
        this.currentSessionId++;
        this.updateUI();

        if (this.audioPlayer) {
            this.audioPlayer.pause();
        }
        if (this.ttsEngine && typeof this.ttsEngine.suspendAudio === 'function') {
            this.ttsEngine.suspendAudio();
        }
        this.releaseWakeLock();
        this.updateMediaMetadata();
    }

    resume() {
        if (!this.isPaused) return;
        this.isPlaying = true;
        this.isPaused = false;
        this.currentSessionId++;
        this.updateUI();

        if (this.audioPlayer) {
            this.audioPlayer.play().catch(e => console.warn('Silent audio play blocked:', e));
        }
        if (this.ttsEngine && typeof this.ttsEngine.resumeAudio === 'function') {
            this.ttsEngine.resumeAudio();
        }
        this.acquireWakeLock();
        this.updateMediaMetadata();
        this.processQueue();
    }

    stop() {
        this.isPlaying = false;
        this.isPaused = false;
        this.isSpeaking = false;
        this.currentSessionId++;
        this.queue = [];
        this.spokenCharIndices.clear();
        this.bufferPool.clear();
        this.currentPlayingToken = null;
        this.currentPlayingCharIndex = null;
        this._currentPageStartOffset = null;
        this.updateUI();

        if (this.audioPlayer) {
            this.audioPlayer.pause();
        }
        if (this.ttsEngine && typeof this.ttsEngine.stopAudio === 'function') {
            this.ttsEngine.stopAudio(false);
        }
        this.releaseWakeLock();
        this.updateMediaMetadata();
    }

    updateUI() {
        if (this.iconEl) {
            this.iconEl.textContent = (this.isPlaying && !this.isPaused) ? '❚❚' : '▶';
        }
        if (this.isPlaying && !this.isPaused) {
            this.setAttribute('playing', '');
        } else {
            this.removeAttribute('playing');
        }
    }

    /**
     * Process speech queue one token at a time with per-word/character TTSEvent emission
     */
    async processQueue() {
        if (this.isSpeaking || !this.isPlaying || this.isPaused) return;

        this.isSpeaking = true;
        const sessionId = this.currentSessionId;

        try {
            while (this.isPlaying && !this.isPaused && this.queue.length > 0 && this.currentSessionId === sessionId) {
                const token = this.queue.shift();
                this.spokenCharIndices.add(token.charIndex);
                this.currentPlayingToken = token;

                // Notify MediaSession and UI of current playing text
                this.updateMediaMetadata(token.text);
                document.body.dispatchEvent(new CustomEvent('ZenTTS:ChunkPlaying', {
                    detail: { text: token.text, charIndex: token.charIndex },
                    bubbles: true
                }));

                // Progress callback emitting TTSEvent per character / word
                const onProgress = (localIdx, char) => {
                    if (this.currentSessionId !== sessionId) return;

                    const charObj = token.chars && token.chars[localIdx] ? token.chars[localIdx] : null;
                    const globalCharIndex = charObj ? charObj.charIndex : (token.charIndex + localIdx);
                    const globalChar = charObj ? charObj.char : (char || token.text[localIdx] || '');

                    this.currentPlayingCharIndex = globalCharIndex;

                    document.body.dispatchEvent(new CustomEvent('TTSEvent', {
                        detail: {
                            charIndex: globalCharIndex,
                            char: globalChar,
                            tokenIndex: token.tokenIndex,
                            lineIndex: charObj ? charObj.lineIndex : token.lineIndex,
                            isTokenEnd: false,
                            session: sessionId
                        },
                        bubbles: true
                    }));
                };

                // Speak using active engine or browser speech synthesis
                await this.speakSentence(token.text, onProgress);

                // If session was cancelled during speaking, break
                if (this.currentSessionId !== sessionId) break;

                // Clean up oldest items in buffer pool
                this.bufferPool.cleanup(token.charIndex);

                // Dispatch TTSEvent for token completion
                const lastCharObj = token.chars && token.chars.length > 0 ? token.chars[token.chars.length - 1] : null;
                const finalCharIndex = lastCharObj ? lastCharObj.charIndex : token.endCharIndex;

                document.body.dispatchEvent(new CustomEvent('TTSEvent', {
                    detail: {
                        charIndex: finalCharIndex,
                        char: lastCharObj ? lastCharObj.char : '',
                        tokenIndex: token.tokenIndex,
                        lineIndex: token.lineIndex,
                        isTokenEnd: true,
                        session: sessionId
                    },
                    bubbles: true
                }));

                // Dispatch SpeachOver & SpeechOver for backward compatibility
                const detail = {
                    text: token.text,
                    charIndex: token.charIndex,
                    endCharIndex: token.endCharIndex,
                    lineIndex: token.lineIndex
                };

                document.body.dispatchEvent(new CustomEvent('SpeachOver', {
                    detail,
                    bubbles: true
                }));
                document.body.dispatchEvent(new CustomEvent('SpeechOver', {
                    detail,
                    bubbles: true
                }));
            }
        } finally {
            this.isSpeaking = false;
            this.currentPlayingToken = null;

            // If a new session was triggered while this one was winding down (e.g. manual navigation), restart queue
            if (this.isPlaying && !this.isPaused && this.queue.length > 0 && this.currentSessionId !== sessionId) {
                console.log('[NavTtsButton] Session changed during playback, restarting queue for new session...');
                this.processQueue();
            } else if (this.isPlaying && !this.isPaused && this.queue.length === 0 && this.currentSessionId === sessionId) {
                // When queue naturally exhausts and we are still actively playing, request nextPage
                console.log('[NavTtsButton] Page queue finished, requesting nextPage...');
                document.body.dispatchEvent(new CustomEvent('ReadingOperation', {
                    detail: { action: 'nextPage' },
                    bubbles: true
                }));
            }
        }
    }

    /**
     * Speak a single sentence using available TTS engine
     * @param {string} text 
     * @param {Function|null} onProgress Callback for (charIndex, char) progress
     * @returns {Promise<void>}
     */
    async speakSentence(text, onProgress = null) {
        const ttsEngine = this.ttsEngine;

        // Option A: Active ZenTTS engine (Matcha or WebSpeech wrapper)
        if (ttsEngine && typeof ttsEngine.speakSentence === 'function') {
            return await ttsEngine.speakSentence(text, onProgress);
        }

        // Option B: Native SpeechSynthesis fallback
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
            return new Promise((resolve) => {
                const utterance = new SpeechSynthesisUtterance(text);
                const app = window._app;
                const voices = window.speechSynthesis.getVoices?.() || [];
                if (app?.ttsVoice && voices.length > 0) {
                    const selectedVoice = voices.find(v => v.voiceURI === app.ttsVoice || v.name === app.ttsVoice);
                    if (selectedVoice) utterance.voice = selectedVoice;
                }
                utterance.rate = app?.ttsSpeed || 1.0;

                if (typeof onProgress === 'function') {
                    utterance.onboundary = (e) => {
                        if (e.name === 'word' || e.name === 'sentence' || e.charIndex !== undefined) {
                            const idx = e.charIndex || 0;
                            const char = text[idx] || '';
                            onProgress(idx, char);
                        }
                    };
                }

                utterance.onend = () => {
                    setTimeout(resolve, 100);
                };
                utterance.onerror = (err) => {
                    if (err.error !== 'interrupted' && err.error !== 'canceled') {
                        console.warn('[NavTtsButton] SpeechSynthesis error:', err);
                    }
                    resolve();
                };

                window.speechSynthesis.speak(utterance);
            });
        }

        // Fallback delay if no audio capability
        await new Promise(r => setTimeout(r, 500));
    }
}

if (typeof window !== 'undefined') {
    window.NavTtsButton = NavTtsButton;
}
if (typeof customElements !== 'undefined' && !customElements.get('nav-tts-button')) {
    customElements.define('nav-tts-button', NavTtsButton);
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { NavTtsButton };
}
