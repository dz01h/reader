class ZenReaderApp {

    static STATE_KEY = 'zen_reader_state';
    static CONFIG_FIELDS = [
        'theme', 'lang', 'fontSize', 'writingMode', 'fontFamily', 'lineHeight', 'margins', 'wordSpacing',
        'lastBookId', 'ttsSpeed', 'ttsVoice', 'ttsEngine', 'ttsModel',
        'quadTL', 'quadTR', 'quadBL', 'quadBR', 'syncCooldown'
    ];

    constructor() {
        window._app = this;

        this.i18n = new I18nManager();

        // Global Error Logging
        window.addEventListener('error', (e) => this.logError(`${e.message} at ${e.filename}:${e.lineno}`));
        window.addEventListener('unhandledrejection', (e) => this.logError(`Unhandled Rejection: ${e.reason}`));

        // State (enumerable configuration fields saved to / restored from localStorage)
        this.theme = 'dark';
        this.lang = 'zh-TW';
        this.fontSize = 18;
        this.writingMode = 'vertical';
        this.fontFamily = 'sans-serif';
        this.lineHeight = 1.8;
        this.margins = { top: 30, bottom: 30, left: 30, right: 30 };
        this.wordSpacing = 1;
        this.lastBookId = null;
        this.ttsSpeed = 1.0;
        this.ttsVoice = 'zh_CN-huayan-medium';
        this.ttsEngine = 'piper';
        this.ttsModel = '';

        // Touch Quadrants
        this.quadTL = 'prev';
        this.quadTR = 'next';
        this.quadBL = 'prev';
        this.quadBR = 'next';

        this.syncCooldown = 15; // default 15 minutes
        this.lastSyncTime = 0;
        this.currentBook = null;

        // Initialize Services
        if (window.ZenGDrive) this.gdrive = new window.ZenGDrive();
        if (window.ZenReadingLog) this.readingLog = new window.ZenReadingLog(this.gdrive);
        if (window.ZenTTS) this.tts = new window.ZenTTS(this);

        // Load and apply saved configuration
        this.loadState();
        this.bindEvents();
    }

    logError(msg) {
        try {
            let logs = JSON.parse(localStorage.getItem('zen_app_error_log') || '[]');
            logs.unshift(`[${new Date().toLocaleString()}] ${msg}`);
            if (logs.length > 50) logs = logs.slice(0, 50);
            localStorage.setItem('zen_app_error_log', JSON.stringify(logs));
        } catch(e) {}
    }

    loadState() {
        try {
            const raw = localStorage.getItem(ZenReaderApp.STATE_KEY) || localStorage.getItem('reader_status');
            if (raw) {
                const state = JSON.parse(raw);
                for (const k of ZenReaderApp.CONFIG_FIELDS) {
                    if (state[k] !== undefined) {
                        if (k === 'margins' && typeof state[k] === 'object' && state[k] !== null) {
                            this.margins = { ...this.margins, ...state[k] };
                        } else {
                            this[k] = state[k];
                        }
                    }
                }
            }
        } catch (e) {
            console.error("Local storage error:", e);
        }
        this.applyState();
    }

    applyState() {
        document.documentElement.setAttribute('data-theme', this.theme || 'dark');
        document.documentElement.setAttribute('data-writing-mode', this.writingMode || 'horizontal');
        document.documentElement.setAttribute('lang', this.lang || 'zh-TW');

        if (this.i18n && this.lang) {
            this.i18n.setLanguage(this.lang);
        } else if (this.i18n) {
            this.i18n.updateDOM();
        }

        document.body.dispatchEvent(new CustomEvent('ReadingOperation', {
            detail: {
                action: 'updateConfig',
                params: [{
                    fontSize: this.fontSize,
                    fontFamily: this.fontFamily,
                    lineHeightRatio: this.lineHeight,
                    margins: this.margins,
                    writingMode: this.writingMode,
                    wordSpacing: this.wordSpacing
                }]
            },
            bubbles: true
        }));
    }

    saveState(updates) {
        if (updates && typeof updates === 'object') {
            Object.assign(this, updates);
        }

        try {
            const state = {};
            for (const k of ZenReaderApp.CONFIG_FIELDS) {
                state[k] = this[k];
            }
            localStorage.setItem(ZenReaderApp.STATE_KEY, JSON.stringify(state));
        } catch (e) {
            console.error("Save state error:", e);
        }
    }

    saveConfig(updates) {
        return this.saveState(updates);
    }

    loadBookIntoReader(book) {
        if (!book) return;
        const doc = (book instanceof window.ReadingDocument)
            ? book
            : new window.ReadingDocument(book.content || '', book.filename || 'Untitled');
        if (book.progress) doc.setProgress(book.progress);

        document.body.dispatchEvent(new CustomEvent('ReadingOperation', {
            detail: { action: 'read', params: [doc] },
            bubbles: true
        }));
    }



    updateThemeColor() {
        const theme = document.documentElement.getAttribute('data-theme') || 'light';
        const color = (theme === 'dark') ? '#0f172a' : '#f9f9fb';
        const metas = document.querySelectorAll('meta[name="theme-color"]');
        if (metas.length === 0) {
            const meta = document.createElement('meta');
            meta.name = "theme-color";
            meta.content = color;
            document.head.appendChild(meta);
        } else {
            metas.forEach(m => m.content = color);
        }
    }

    updateGoogleUIState() {
        const hasAuth = !!localStorage.getItem('gdrive_auth');
        const btnGDrive = document.getElementById('btn-gdrive');
        if (btnGDrive) {
            btnGDrive.style.opacity = hasAuth ? '1' : '0.5';
            btnGDrive.style.pointerEvents = hasAuth ? 'auto' : 'none';
        }

        if (this.settings) {
            if (this.settings.btnSyncQr) {
                this.settings.btnSyncQr.disabled = !hasAuth;
                this.settings.btnSyncQr.style.opacity = hasAuth ? '1' : '0.5';
            }
            if (this.settings.syncCooldownSelect) {
                this.settings.syncCooldownSelect.disabled = !hasAuth;
            }
            if (this.settings.btnGoogleLogin) {
                this.settings.btnGoogleLogin.textContent = hasAuth ? '已登入 Google (點此重新授權)' : '登入 Google 帳號';
            }
            if (this.settings.btnOpenReadingLog) {
                this.settings.btnOpenReadingLog.style.display = hasAuth ? 'block' : 'none';
            }
        }
    }

    showToast(msg, duration = 3000) {
        document.body.dispatchEvent(new CustomEvent('showInToast', {
            detail: { message: msg, duration },
            bubbles: true
        }));
    }

    hideToast() {
        document.body.dispatchEvent(new CustomEvent('showInToast', {
            detail: { action: 'hide', message: '' },
            bubbles: true
        }));
    }



    // Helper methods
    decodeText(uint8array) {
        if (uint8array.length >= 2) {
            if (uint8array[0] === 0xFF && uint8array[1] === 0xFE) return new TextDecoder('utf-16le').decode(uint8array);
            if (uint8array[0] === 0xFE && uint8array[1] === 0xFF) return new TextDecoder('utf-16be').decode(uint8array);
        }
        if (uint8array.length >= 3 && uint8array[0] === 0xEF && uint8array[1] === 0xBB && uint8array[2] === 0xBF) return new TextDecoder('utf-8').decode(uint8array);
        try {
            return new TextDecoder('utf-8', { fatal: true }).decode(uint8array);
        } catch (e) {
            let fallbackEnc = 'big5';
            if (this.i18n) {
                if (this.i18n.lang === 'zh-CN') fallbackEnc = 'gbk';
                else if (this.i18n.lang === 'ja-JP') fallbackEnc = 'shift-jis';
                else if (this.i18n.lang === 'en-US') fallbackEnc = 'windows-1252';
            }
            try { return new TextDecoder(fallbackEnc, { fatal: true }).decode(uint8array); }
            catch(e2) { return new TextDecoder(fallbackEnc).decode(uint8array); }
        }
    }

    async processExternalText(text) {
        if (!this.gdrive || !this.readingLog) return text;
        const token = await this.gdrive.getAccessToken();
        if (!token) return text;

        this.showToast('正在取得用詞替換表...', 0);
        try {
            const dict = await this.readingLog.getReplacementDict();
            if (dict && dict.length > 0) {
                this.showToast('正在套用用詞替換...', 0);
                for (let i = 0; i < dict.length; i++) {
                    const { target, replacement } = dict[i];
                    if (target && replacement) {
                        text = text.split(target).join(replacement);
                    }
                }
            }
        } catch (e) {
            console.error('Failed to apply replacement dict', e);
        } finally {
            this.hideToast();
        }
        return text;
    }

    async handleFile(file) {
        if (!file) return;
        if (file.name.toLowerCase().endsWith('.zip')) {
            if (this.zipHandler) this.zipHandler.processZip(file, file.name);
            return;
        }
        const reader = new FileReader();
        reader.onload = async (e) => {
            let text = await this.decodeText(new Uint8Array(e.target.result));
            text = await this.processExternalText(text);
            await window.ZenOPFS.saveFile(file.name, text);
            const book = new window.ZenBook(file.name, text);
            book.loadProgress();
            this.loadBookIntoReader(book);
        };
        reader.readAsArrayBuffer(file);
    }

    handleURLSync() {
        const urlParams = new URLSearchParams(window.location.search);
        const syncPayload = urlParams.get('sync');
        if (syncPayload) {
            try {
                const state = JSON.parse(atob(syncPayload));
                if (state.lang) this.setLanguage(state.lang);
                if (state.theme) this.setTheme(state.theme);
                if (state.fontSize) this.setFontSize(state.fontSize);
                if (state.lineHeight) this.setLineHeight(state.lineHeight);
                if (state.margins) this.setMargins(state.margins);
                this.showToast('設定同步成功！');
                if (this.settings) this.settings.syncUI();
                window.history.replaceState({}, document.title, window.location.pathname);
            } catch (e) { console.error('Sync failed:', e); }
        }
    }

    // Setters
    setTheme(newTheme) {
        this.theme = newTheme;
        document.documentElement.setAttribute('data-theme', newTheme);
        if (typeof this.updateThemeColor === 'function') this.updateThemeColor();
        this.saveState();
    }
    setWritingMode(mode) {
        this.writingMode = mode;
        document.documentElement.setAttribute('data-writing-mode', mode);
        this.saveState();
        this.applyLayoutChange();
    }
    setFontSize(size) {
        this.fontSize = size;
        this.saveState();
        this.applyLayoutChange();
    }
    setFontFamily(family) {
        this.fontFamily = family;
        this.saveState();
        this.applyLayoutChange();
    }
    setLineHeight(ratio) {
        this.lineHeight = ratio;
        this.saveState();
        this.applyLayoutChange();
    }
    setMargins(updates) {
        this.margins = { ...this.margins, ...updates };
        this.saveState();
        this.applyLayoutChange();
    }
    setSyncCooldown(minutes) {
        this.syncCooldown = parseInt(minutes);
        this.saveState();
        if (this.readingLog) {
            this.readingLog.setCooldown(this.syncCooldown);
        }
    }
    setLanguage(langCode) {
        this.lang = langCode;
        if (this.i18n) this.i18n.setLanguage(langCode);
        this.saveState();
    }

    setTTSSpeed(val) {
        this.ttsSpeed = parseFloat(val);
        this.saveState();
    }

    setTTSEngine(val) {
        this.ttsEngine = val;
        this.saveState();
        if (this.tts) {
            this.tts.switchEngine(val);
        }
    }

    setTTSVoice(val) {
        this.ttsVoice = val;
        this.saveState();
        if (this.tts && this.tts.isPlaying) {
            this.tts.stop();
            this.tts.start();
        }
    }

    setTTSModel(engine, voice) {
        const engineChanged = this.ttsEngine !== engine;
        this.ttsEngine = engine;
        this.ttsVoice = voice;
        this.saveState();

        if (engineChanged && this.tts) {
            this.tts.switchEngine(engine);
        } else if (this.tts && this.tts.isPlaying) {
            this.tts.stop();
            this.tts.start();
        }
    }

    setQuad(quad, action) {
        this[`quad${quad}`] = action;
        this.saveState();
    }

    bindEvents() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.addEventListener('message', async (event) => {
                if (event.data && event.data.type === 'REQUEST_TTS_SYNC') {
                    if (this.readingLog && this.gdrive) {
                        const token = await this.gdrive.getAccessToken();
                        if (token) {
                            const dict = await this.readingLog.getCustomTTSDict();
                            if (Object.keys(dict).length > 0) {
                                if (!window.ZenTTSCustomDict) window.ZenTTSCustomDict = {};
                                Object.assign(window.ZenTTSCustomDict, dict);
                                if (navigator.serviceWorker.controller) {
                                    navigator.serviceWorker.controller.postMessage({
                                        type: 'UPDATE_TTS_DICT',
                                        payload: dict
                                    });
                                }
                            }
                        }
                    }
                }
            });
        }

        document.body.addEventListener('ZenTTS:Status', (e) => {
            if (e.detail.status === 'loading') {
                this.showToast(e.detail.message, 0);
            } else if (e.detail.status === 'ready') {
                this.showToast('語音引擎已就緒！', 2000);
            } else if (e.detail.status === 'error') {
                this.showToast(`語音載入失敗: ${e.detail.message}`, 4000);
                if (this.tts && this.tts.isPlaying) {
                    this.tts.stop();
                }
            }
        });

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState !== 'visible' && this.readingLog) {
                this.readingLog.resetInit();
            }
        });
    }
}

window.ZenReaderApp = ZenReaderApp;
document.addEventListener('DOMContentLoaded', () => { new ZenReaderApp(); });
