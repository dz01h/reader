/**
 * NavTtsButton
 * Web Component extending ToggleButton to control TTS playback.
 * Listens for ReadingPanelRenderOver to parse visible sentences with character position tracking,
 * dispatches SpeachOver event after each sentence, and coordinates automatic page turns.
 */
class NavTtsButton extends (window.ToggleButton || window.Component || HTMLElement) {
    constructor() {
        super();

        this.isPlaying = false;
        this.isPaused = false;
        this.isSpeaking = false;

        this.queue = [];
        this.spokenCharIndices = new Set();
        this.currentSessionId = 0;
        this.lastRenderData = null;
        this.lastDocTitle = null;

        this.initComponent();
    }

    initComponent() {
        if (typeof super.initComponent === 'function') {
            super.initComponent();
        }

        this.classList.add('nav-tts-button');
        this.setAttribute('role', 'button');
        this.setAttribute('title', '語音朗讀 (TTS)');

        // If icon span doesn't exist, create it
        let icon = this.querySelector('#tts-icon');
        if (!icon) {
            icon = document.createElement('span');
            icon.id = 'tts-icon';
            icon.textContent = '▶';
            this.appendChild(icon);
        }
        this.iconEl = icon;

        this.mountEvents();
    }

    mountEvents() {
        // Toggle on click
        this.addEventListener('click', (e) => {
            e.preventDefault();
            this.toggle();
        });

        // Listen for ReadingPanelRenderOver to obtain visible page text and char positions
        document.body.addEventListener('ReadingPanelRenderOver', (e) => {
            if (e.detail) {
                this.onRenderOver(e.detail);
            }
        });

        // Listen for ReadingOperation to reset or handle external actions
        document.body.addEventListener('ReadingOperation', (e) => {
            const action = e.detail?.action;
            if (action === 'reset') {
                this.stop();
                this.spokenCharIndices.clear();
                this.queue = [];
            } else if (action === 'toggleTTS' || action === 'toggle-tts') {
                this.toggle();
            }
        });

        // Listen for ActionPerformed from action-buttons
        document.body.addEventListener('ActionPerformed', (e) => {
            const action = e.detail?.action;
            if (action === 'toggleTTS' || action === 'toggle-tts' || action === 'btn-tts-toggle') {
                this.toggle();
            }
        });
    }

    /**
     * Split line text into sentences while tracking exact character offsets in document
     * @param {string} lineText 
     * @param {number} lineStartChar 
     * @param {number} lineIndex 
     * @returns {Array<{ text: string, charIndex: number, endCharIndex: number, lineIndex: number }>}
     */
    extractSentencesFromLine(lineText, lineStartChar, lineIndex) {
        if (!lineText || !lineText.trim()) return [];

        const sentences = [];
        // Match sentence segments ending with punctuation or end of line
        const regex = /[^，。、；：！？－—…\n\r\t]+[，。、；：！？－—…]*/g;
        let match;

        while ((match = regex.exec(lineText)) !== null) {
            const rawSegment = match[0];
            const cleanText = rawSegment.replace(/\p{P}/gu, '').trim();
            if (cleanText.length > 0) {
                const startChar = lineStartChar + match.index;
                const endChar = startChar + rawSegment.length;
                sentences.push({
                    text: cleanText,
                    charIndex: startChar,
                    endCharIndex: endChar,
                    lineIndex: lineIndex
                });
            }
        }

        // Fallback if no punctuation matched but text exists
        if (sentences.length === 0 && lineText.trim().length > 0) {
            const cleanText = lineText.replace(/\p{P}/gu, '').trim();
            if (cleanText.length > 0) {
                sentences.push({
                    text: cleanText,
                    charIndex: lineStartChar,
                    endCharIndex: lineStartChar + lineText.length,
                    lineIndex: lineIndex
                });
            }
        }

        return sentences;
    }

    /**
     * Handle ReadingPanelRenderOver event data
     * Parses visible sentences on current page and deduplicates by charIndex
     * @param {Object} renderData 
     */
    onRenderOver(renderData) {
        this.lastRenderData = renderData;

        if (!renderData || !renderData.lines || renderData.lines.length === 0) return;

        const lines = renderData.lines;
        const lineIndexs = renderData.lineIndexs || [];
        const zeroIndex = renderData.zeroIndex || 0;
        const linesPerPage = renderData.linesPerPage || 15;
        const lastLineIdx = Math.min(lines.length - 1, zeroIndex + linesPerPage - 1);

        const currentStartOffset = lineIndexs[zeroIndex] ?? 0;

        // If reading jumped backwards or to another book/position, clear spoken records
        if (this._lastZeroCharOffset !== undefined && Math.abs(currentStartOffset - this._lastZeroCharOffset) > 2000) {
            this.spokenCharIndices.clear();
            this.queue = [];
        }
        this._lastZeroCharOffset = currentStartOffset;

        // Parse visible page lines
        const newSentences = [];
        for (let i = zeroIndex; i <= lastLineIdx; i++) {
            const lineText = lines[i];
            const lineStartChar = lineIndexs[i] ?? 0;
            const lineSentences = this.extractSentencesFromLine(lineText, lineStartChar, i);

            for (const s of lineSentences) {
                if (!this.spokenCharIndices.has(s.charIndex)) {
                    // Check if already in queue
                    if (!this.queue.some(q => q.charIndex === s.charIndex)) {
                        newSentences.push(s);
                    }
                }
            }
        }

        if (newSentences.length > 0) {
            this.queue.push(...newSentences);
        }

        // If playing and currently idle, continue speaking loop
        if (this.isPlaying && !this.isPaused && !this.isSpeaking) {
            this.processQueue();
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

        // Acquire WakeLock & start background audio loop via ZenTTS if available
        if (window._app?.tts) {
            window._app.tts.isPlaying = true;
            window._app.tts.isPaused = false;
            window._app.tts.acquireWakeLock?.();
            window._app.tts.audioPlayer?.play?.().catch(() => {});
        }

        // If queue is empty, request fresh render over from reading panel
        if (this.queue.length === 0) {
            if (this.lastRenderData) {
                this.onRenderOver(this.lastRenderData);
            } else {
                document.body.dispatchEvent(new CustomEvent('ReadingOperation', {
                    detail: { action: 'render', params: [true] },
                    bubbles: true
                }));
            }
        } else {
            this.processQueue();
        }
    }

    pause() {
        this.isPlaying = false;
        this.isPaused = true;
        this.currentSessionId++;
        this.updateUI();

        if (window._app?.tts) {
            window._app.tts.isPlaying = false;
            window._app.tts.isPaused = true;
            window._app.tts.pause?.();
        }
    }

    resume() {
        this.isPlaying = true;
        this.isPaused = false;
        this.currentSessionId++;
        this.updateUI();

        if (window._app?.tts) {
            window._app.tts.isPlaying = true;
            window._app.tts.isPaused = false;
            window._app.tts.resume?.();
        }

        this.processQueue();
    }

    stop() {
        this.isPlaying = false;
        this.isPaused = false;
        this.isSpeaking = false;
        this.currentSessionId++;
        this.queue = [];
        this.updateUI();

        if (window._app?.tts) {
            window._app.tts.stop?.();
        }
    }

    updateUI() {
        if (this.iconEl) {
            this.iconEl.textContent = (this.isPlaying && !this.isPaused) ? '❚❚' : '▶';
        }
        if (this.switching) {
            this.switching.checked = this.isPlaying && !this.isPaused;
        }
    }

    /**
     * Process speech queue one sentence at a time
     */
    async processQueue() {
        if (this.isSpeaking || !this.isPlaying || this.isPaused) return;

        this.isSpeaking = true;
        const sessionId = this.currentSessionId;

        while (this.isPlaying && !this.isPaused && this.queue.length > 0 && this.currentSessionId === sessionId) {
            const item = this.queue.shift();
            this.spokenCharIndices.add(item.charIndex);

            // Notify MediaSession of current playing text
            document.body.dispatchEvent(new CustomEvent('ZenTTS:ChunkPlaying', {
                detail: { text: item.text },
                bubbles: true
            }));

            // Speak using active engine or browser speech synthesis
            await this.speakSentence(item.text);

            // If session was cancelled during speaking, break
            if (this.currentSessionId !== sessionId) break;

            // Dispatch SpeachOver & SpeechOver with sentence position info
            const detail = {
                text: item.text,
                charIndex: item.charIndex,
                endCharIndex: item.endCharIndex,
                lineIndex: item.lineIndex
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

        this.isSpeaking = false;
    }

    /**
     * Speak a single sentence using available TTS engine
     * @param {string} text 
     * @returns {Promise<void>}
     */
    async speakSentence(text) {
        const app = window._app;
        const ttsEngine = app?.tts?.ttsEngine;

        // Option A: Active ZenTTS engine (Matcha or WebSpeech wrapper)
        if (ttsEngine && typeof ttsEngine.speakSentence === 'function') {
            return await ttsEngine.speakSentence(text);
        }

        // Option B: Native SpeechSynthesis fallback
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
            return new Promise((resolve) => {
                const utterance = new SpeechSynthesisUtterance(text);
                const voices = window.speechSynthesis.getVoices?.() || [];
                if (app?.ttsVoice && voices.length > 0) {
                    const selectedVoice = voices.find(v => v.voiceURI === app.ttsVoice || v.name === app.ttsVoice);
                    if (selectedVoice) utterance.voice = selectedVoice;
                }
                utterance.rate = app?.ttsSpeed || 1.0;

                utterance.onend = () => {
                    setTimeout(resolve, 150);
                };
                utterance.onerror = (err) => {
                    console.warn('[NavTtsButton] SpeechSynthesis error:', err);
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
