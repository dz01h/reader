class ZenReaderApp {
    constructor() {
        // State
        this.currentFontSize = 18;
        this.currentWritingMode = 'horizontal';
        this.currentFontFamily = 'sans-serif';
        this.currentLineHeight = 1.8;
        this.margins = { top: 30, bottom: 30, left: 30, right: 30 };
        this.currentBook = null;
        this.ttsSpeed = 1.0;
        this.ttsVoice = 'zh_CN-huayan-medium';
        this.ttsEngine = 'piper';

        // Touch Quadrants
        this.quadTL = 'prev';
        this.quadTR = 'next';
        this.quadBL = 'prev';
        this.quadBR = 'next';

        this.STATE_KEY = 'zen_reader_state';

        this.syncCooldown = 15; // default 15 minutes
        this.lastSyncTime = 0;

        // Ensure dependencies are loaded
        if (!window.ZenDB || !window.ZenEngine || !window.ReadingPanel || !window.ZenTTS) {
            console.error("Required module classes (ZenDB, ZenEngine, ReadingPanel, ZenTTS) are missing!");
            return;
        }

        // Initialize internal modules
        if (window.I18n) {
            this.i18n = new window.I18n();
        }

        this.db = new window.ZenDB();

        this.initDOM();

        // Initialize Core Components
        this.readingPanel = new window.ReadingPanel(this, this.els.canvas);
        this.engine = this.readingPanel.engine;
        this.tts = new window.ZenTTS(this);

        // GDrive module
        if (window.ZenGDrive) {
            this.gdrive = new window.ZenGDrive(this);
        }

        // Reading Progress Sync
        if (window.ZenReadingLog) {
            this.readingLog = new window.ZenReadingLog(this.gdrive);
        }

        // Settings Dialog module
        if (window.ZenSettings) {
             this.settings = new window.ZenSettings(this);
        }

        // File Explorer module
        if (window.FileExplorer) {
             this.explorer = new window.FileExplorer(this);
        }

        // Zip Handler module
        if (window.ZenZipHandler) {
             this.zipHandler = new window.ZenZipHandler(this);
        }

        this.bindEvents();
        this.loadState();
        this.handleURLSync();

        // Listen for remote progress signal from GAS
        document.body.addEventListener('readingLog', (e) => this.handleRemoteProgress(e.detail));
    }

    initDOM() {
        this.els = {
            dropZone: document.getElementById('welcome-screen'),
            fileInput: document.getElementById('file-input'),
            btnRecentBooks: document.getElementById('btn-recent-books'),
            btnUpload: document.getElementById('btn-upload'),
            btnGDrive: document.getElementById('btn-gdrive'),
            readerContainer: document.getElementById('reader-container'),
            documentTitle: document.getElementById('document-title'),
            canvas: document.getElementById('reader-canvas'),

            btnCloseReader: document.getElementById('btn-close-reader'),
            headerCenter: document.getElementById('header-center'),

            statusBar: document.getElementById('status-bar'),
            progressSlider: document.getElementById('progress-slider'),
            pageIndicator: document.getElementById('page-indicator')
        };
    }

    async loadState() {
        const savedState = localStorage.getItem(this.STATE_KEY);
        if (savedState) {
            try {
                const state = JSON.parse(savedState);
                if (state.theme) {
                    document.documentElement.setAttribute('data-theme', state.theme);
                } else {
                    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
                }

                if (state.fontSize) this.currentFontSize = state.fontSize;
                if (state.writingMode) {
                    this.currentWritingMode = state.writingMode;
                    document.documentElement.setAttribute('data-writing-mode', this.currentWritingMode);
                }
                if (state.fontFamily) this.currentFontFamily = state.fontFamily;
                if (state.lineHeight) this.currentLineHeight = state.lineHeight;
                if (state.margins) {
                    this.margins = state.margins;
                }
                if (state.syncCooldown) this.syncCooldown = state.syncCooldown;
                if (state.ttsSpeed) {
                    this.ttsSpeed = state.ttsSpeed;
                }
                if (state.ttsEngine) this.ttsEngine = state.ttsEngine;
                if (state.ttsVoice) this.ttsVoice = state.ttsVoice;

                // Validate loaded voice to prevent worker crash loop from invalid/deprecated values
                if (this.ttsEngine === 'piper') {
                    const validPiper = ['zh_CN-huayan-medium', 'zh_CN-huayan-x_low'];
                    if (!validPiper.includes(this.ttsVoice)) {
                        this.ttsVoice = 'zh_CN-huayan-medium';
                    }
                } else if (this.ttsEngine === 'kokoro') {
                    // v1.0 model voices (English only)
                    const validKokoro = [
                        'af_heart', 'af_bella', 'af_sarah', 'af_sky',
                        'af_alloy', 'af_aoede', 'af_jessica', 'af_kore', 'af_nicole', 'af_nova', 'af_river',
                        'am_adam', 'am_michael', 'am_echo', 'am_eric', 'am_fenrir', 'am_liam', 'am_onyx', 'am_puck', 'am_santa',
                        'bf_emma', 'bf_isabella', 'bf_alice', 'bf_lily',
                        'bm_george', 'bm_lewis', 'bm_daniel', 'bm_fable'
                    ];
                    if (!validKokoro.includes(this.ttsVoice)) {
                        this.ttsVoice = 'af_heart';
                    }
                }

                if (this.ttsEngine && this.tts) {
                    this.tts.switchEngine(this.ttsEngine);
                }

                if (state.quadTL) this.quadTL = state.quadTL;
                if (state.quadTR) this.quadTR = state.quadTR;
                if (state.quadBL) this.quadBL = state.quadBL;
                if (state.quadBR) this.quadBR = state.quadBR;

                if (state.lang && this.i18n) {
                    this.i18n.setLanguage(state.lang);
                } else if (this.i18n) {
                    this.i18n.updateDOM();
                }
                
                if (state.lastBookId) this.lastBookId = state.lastBookId;
            } catch (e) {
                console.error("Local storage error:", e);
            }
        } else {
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
        }

        let book = null;
        if (this.lastBookId) {
            book = await window.ZenBook.loadBook(this.db, this.lastBookId);
        }
        
        // Fallback: If no lastBookId but there is a recent book, pick the most recent one
        if (!book) {
            const recentBooks = await window.ZenBook.getRecentBooks(this.db);
            if (recentBooks && recentBooks.length > 0) {
                this.lastBookId = recentBooks[0].id;
                book = await window.ZenBook.loadBook(this.db, this.lastBookId);
            }
        }

        if (book) {
            this.loadBookIntoReader(book);
            this.showToast(`已載入上次閱讀的書籍`);
        } else {
            this.closeReader();
        }

        this.updateThemeColor();
    }

    saveState(updates) {
        const savedState = localStorage.getItem(this.STATE_KEY);
        let state = savedState ? JSON.parse(savedState) : {};
        state = { ...state, ...updates };
        try {
            localStorage.setItem(this.STATE_KEY, JSON.stringify(state));
        } catch (e) { }
    }

    saveProgress() {
        if (!this.currentBook) return;
        const scrollOffset = this.readingPanel.scrollOffset;
        const maxScroll = this.readingPanel.maxScroll;
        const progress = maxScroll > 0 ? scrollOffset / maxScroll : 0;

        this.currentBook.saveProgress(progress);
    }

    rebuildAndShow(targetScroll = 0) {
        if (!this.currentBook) return;

        const rect = this.els.canvas.getBoundingClientRect();
        // Use Math.floor to ensure integer dimensions for the layout engine
        const cw = Math.floor(rect.width);
        const ch = Math.floor(rect.height);

        const { drawOps, maxScroll } = this.engine.layoutDocument(
            this.currentBook.content,
            this.currentFontSize,
            this.currentWritingMode,
            cw, ch,
            this.currentLineHeight,
            this.currentFontFamily,
            this.margins
        );

        this.readingPanel.setLayout(drawOps, maxScroll, targetScroll);
        this.els.statusBar.classList.remove('hidden');
    }

    onScroll(scrollOffset, maxScroll) {
        // TTS visibility check is now handled via the 'ReadingOver' event in tts.js
    }

    applyLayoutChange() {
        if (!this.currentBook) return;
        const currentPercent = this.readingPanel.maxScroll > 0 ? this.readingPanel.scrollOffset / this.readingPanel.maxScroll : 0;
        this.rebuildAndShow(0);
        const targetScroll = this.readingPanel.maxScroll * currentPercent;
        this.readingPanel.setScrollOffset(this.readingPanel.snapToGrid(targetScroll));
    }

    loadBookIntoReader(book) {
        this.currentBook = book;
        this.saveState({ lastBookId: book.id });
        this.els.documentTitle.textContent = book.filename;

        if (this.readingLog) {
            this.readingLog.setReadingBook(book.filename);
            this.readingLog.setCooldown(this.syncCooldown);
        }

        document.body.classList.add('reading-mode');
        document.body.classList.remove('ui-hidden');
        this.updateThemeColor();

        this.els.dropZone.classList.add('hidden');
        this.els.readerContainer.classList.remove('hidden');
        this.els.headerCenter.classList.remove('hidden');
        this.els.btnCloseReader.classList.remove('hidden');

        if (!history.state || history.state.reading !== true) {
            history.pushState({ reading: true }, '', '#reading');
        }

        this.readingPanel.resize();

        const targetProgress = book.progress || 0;

        this.rebuildAndShow(0);
        this.readingPanel.setScrollOffset(this.readingPanel.maxScroll * targetProgress);

        if (this.gdrive) {
            this.checkAndSyncCloudProgress();
        }
    }

    async closeReader(isFromHistory = false) {
        if (this.tts) this.tts.stop();
        document.body.classList.remove('reading-mode');
        document.body.classList.remove('ui-hidden');
        this.updateThemeColor();
        this.els.readerContainer.classList.add('hidden');
        this.els.headerCenter.classList.add('hidden');
        this.els.btnCloseReader.classList.add('hidden');
        this.els.dropZone.classList.remove('hidden');
        this.els.statusBar.classList.add('hidden');
        
        this.switchWelcomeView('recent');
        
        this.els.documentTitle.textContent = '';
        if (this.currentBook) {
            this.currentBook = null;
        }
        this.els.fileInput.value = '';

        this.readingPanel.reset();

        if (!isFromHistory) {
            if (history.state && history.state.reading === true) {
                history.back();
            }
        }
    }

    switchWelcomeView(viewName) {
        const recentBooksBtn = this.els.btnRecentBooks;
        const uploadBtn = this.els.btnUpload;
        const gdriveBtn = this.els.btnGDrive;
        
        const recentContainer = document.getElementById('recent-books-container');
        const explorerList = document.getElementById('file-explorer-list');
        const fileExplorer = this.fileExplorer; // assuming this exists or global

        if (recentBooksBtn) recentBooksBtn.classList.remove('active');
        if (uploadBtn) uploadBtn.classList.remove('active');
        if (gdriveBtn) gdriveBtn.classList.remove('active');

        if (viewName === 'recent') {
            if (recentBooksBtn) recentBooksBtn.classList.add('active');
            if (recentContainer) recentContainer.classList.remove('hidden');
            if (explorerList) explorerList.classList.add('hidden');
            if (window.fileExplorer && window.fileExplorer.footerEl) {
                window.fileExplorer.footerEl.classList.add('hidden');
            }
            this.renderRecentBooks();
        } else if (viewName === 'explorer') {
            // Active state depends on if it's GDrive or Local, but for simplicity we can set active when used
            if (recentContainer) recentContainer.classList.add('hidden');
            if (explorerList) explorerList.classList.remove('hidden');
            // Footer visibility is handled by file-explorer.js when rendering breadcrumbs
            if (window.fileExplorer) window.fileExplorer.renderBreadcrumbs();
        }
    }

    async renderRecentBooks() {
        const container = document.getElementById('recent-books-container');
        const grid = document.getElementById('recent-books-grid');
        if (!container || !grid) return;

        const recentBooks = await window.ZenBook.getRecentBooks(this.db);
        if (!recentBooks || recentBooks.length === 0) {
            container.classList.add('hidden');
            return;
        }

        container.classList.remove('hidden');
        grid.innerHTML = '';
        recentBooks.forEach(meta => {
            const card = document.createElement('div');
            card.className = 'recent-book-card';
            
            const date = new Date(meta.timestamp);
            const dateString = `${date.getMonth()+1}/${date.getDate()} ${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}`;
            const progressPercent = Math.round((meta.progress || 0) * 100);

            card.innerHTML = `
                <div class="recent-book-title" title="${meta.filename}">${meta.filename}</div>
                <div class="recent-book-meta">
                    <span>${progressPercent}%</span>
                    <span>${dateString}</span>
                </div>
                <div class="recent-book-progress-bar">
                    <div class="recent-book-progress-fill" style="width: ${progressPercent}%"></div>
                </div>
            `;
            
            card.addEventListener('click', async () => {
                const book = await window.ZenBook.loadBook(this.db, meta.id);
                if (book) {
                    this.loadBookIntoReader(book);
                } else {
                    this.showToast('無法載入書籍 (IDB_NOT_FOUND)');
                    await this.db.deleteBook(meta.id);
                    this.renderRecentBooks();
                }
            });
            grid.appendChild(card);
        });
    }

    updateSyncStatus(status, message = '') {
        const el = document.getElementById('sync-status');
        const timeEl = document.getElementById('sync-time');
        const msgEl = document.getElementById('sync-msg');

        if (!el) return;

        el.classList.remove('hidden', 'syncing', 'success', 'error');

        if (status === 'syncing') {
            el.classList.add('syncing');
            msgEl.textContent = message || (this.i18n ? this.i18n.t('syncing') : 'Syncing...');
        } else if (status === 'success') {
            el.classList.add('success');
            timeEl.textContent = new Date().toLocaleTimeString();
            msgEl.textContent = message || (this.i18n ? this.i18n.t('syncSuccess') : 'Sync successful');
        } else if (status === 'error') {
            el.classList.add('error');
            timeEl.textContent = new Date().toLocaleTimeString();
            msgEl.textContent = message || (this.i18n ? this.i18n.t('syncError') : 'Sync failed');
        } else {
            el.classList.add('hidden');
        }
    }

    toggleUI() {
        document.body.classList.toggle('ui-hidden');
    }

    updateThemeColor() {
        const theme = document.documentElement.getAttribute('data-theme') || 'light';
        const color = (theme === 'dark') ? '#0f172a' : '#f9f9fb';
        const metas = document.querySelectorAll('meta[name="theme-color"]');
        if (metas.length === 0) {
            const meta = document.createElement('meta');
            meta.name = 'theme-color';
            meta.content = color;
            document.head.appendChild(meta);
        } else {
            metas.forEach(m => m.setAttribute('content', color));
        }
    }

    showToast(msg, duration = 3000) {
        const toast = document.getElementById('toast');
        if (!toast) return;
        toast.textContent = msg;
        toast.classList.add('show');
        if (this.toastTimeout) clearTimeout(this.toastTimeout);
        if (duration > 0) {
            this.toastTimeout = setTimeout(() => toast.classList.remove('show'), duration);
        }
    }

    // Cloud Sync
    checkAndSyncCloudProgress() {
        if (!document.body.classList.contains('reading-mode') || !this.gdrive || !this.readingLog || !navigator.onLine) return;
        if (!this.currentBook) return;
        const filename = this.currentBook.filename;
        const localProg = this.readingPanel.maxScroll > 0 ? this.readingPanel.scrollOffset / this.readingPanel.maxScroll : 0;
        const localTs = this.currentBook.timestamp || 0;

        if (this.readingLog) {
            this.readingLog.syncSheetProgress(filename, localProg, localTs).then(remote => {
                if (remote) this.handleRemoteProgress(remote);
                else this.performRemoteSync(filename, this.readingPanel.scrollOffset);
            });
        }
    }

    handleRemoteProgress(remote) {
        if (!remote || !remote.progress || !this.currentBook) return;

        const currentSavedTs = this.currentBook.timestamp || 0;
        const localProg = this.readingPanel.maxScroll > 0 ? this.readingPanel.scrollOffset / this.readingPanel.maxScroll : 0;

        // If remote time is older or same, ignore (unless local is 0)
        if (localProg > 0 && new Date(remote.time).getTime() <= currentSavedTs) return;

        if (confirm(`發現更晚的雲端進度 (${new Date(remote.time).toLocaleString()})\n進度：${(remote.progress * 100).toFixed(2)}%\n是否跳轉？`)) {
            const targetScroll = this.readingPanel.maxScroll * remote.progress;
            this.readingPanel.setScrollOffset(this.readingPanel.snapToGrid(targetScroll));

            // update local save immediately
            this.currentBook.timestamp = new Date(remote.time).getTime();
            this.currentBook.saveProgress(remote.progress);
        }
    }

    performRemoteSync(filename, offset) {
        if (!this.readingLog) return;
        const progress = this.readingPanel.maxScroll > 0 ? offset / this.readingPanel.maxScroll : 0;
        this.readingLog.updateSheetProgress(filename, progress, new Date().toISOString());
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

    async handleFile(file) {
        if (!file) return;
        if (file.name.toLowerCase().endsWith('.zip')) {
            if (this.zipHandler) this.zipHandler.processZip(file, file.name);
            return;
        }
        const reader = new FileReader();
        reader.onload = async (e) => {
            const text = await this.decodeText(new Uint8Array(e.target.result));
        const book = new window.ZenBook(file.name, text);
        book.loadProgress();
        await book.saveToDB(this.db);
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
        document.documentElement.setAttribute('data-theme', newTheme);
        this.updateThemeColor();
        this.saveState({ theme: newTheme });
    }
    setWritingMode(mode) {
        this.currentWritingMode = mode;
        document.documentElement.setAttribute('data-writing-mode', mode);
        this.saveState({ writingMode: mode });
        this.applyLayoutChange();
    }
    setFontSize(size) {
        this.currentFontSize = size;
        this.saveState({ fontSize: size });
        this.applyLayoutChange();
    }
    setLineHeight(ratio) {
        this.currentLineHeight = ratio;
        this.saveState({ lineHeight: ratio });
        this.applyLayoutChange();
    }
    setMargins(updates) {
        this.margins = { ...this.margins, ...updates };
        this.saveState({ margins: this.margins });
        this.applyLayoutChange();
    }
    setSyncCooldown(minutes) {
        this.syncCooldown = parseInt(minutes);
        this.saveState({ syncCooldown: this.syncCooldown });
        if (this.readingLog) {
            this.readingLog.setCooldown(this.syncCooldown);
        }
    }
    setLanguage(langCode) {
        if (this.i18n && this.i18n.setLanguage(langCode)) this.saveState({ lang: langCode });
    }

    setTTSSpeed(val) {
        this.ttsSpeed = parseFloat(val);
        this.saveState({ ttsSpeed: this.ttsSpeed });
    }

    setTTSEngine(val) {
        this.ttsEngine = val;
        this.saveState({ ttsEngine: this.ttsEngine });
        if (this.tts) {
            this.tts.switchEngine(val);
        }
    }

    setTTSVoice(val) {
        this.ttsVoice = val;
        this.saveState({ ttsVoice: this.ttsVoice });
        // Optional: WebSpeech API might be able to change voices dynamically, but
        // restart ensures it picks up correctly.
        if (this.tts && this.tts.isPlaying) {
            this.tts.stop();
            this.tts.start();
        }
    }

    setTTSModel(engine, voice) {
        const engineChanged = this.ttsEngine !== engine;
        this.ttsEngine = engine;
        this.ttsVoice = voice;
        this.saveState({ ttsEngine: engine, ttsVoice: voice });

        if (engineChanged && this.tts) {
            this.tts.switchEngine(engine);
        } else if (this.tts && this.tts.isPlaying) {
            this.tts.stop();
            this.tts.start();
        }
    }

    setQuad(quad, action) {
        this[`quad${quad}`] = action;
        const update = {};
        update[`quad${quad}`] = action;
        this.saveState(update);
    }

    bindEvents() {
        if (this.els.btnCloseReader) {
            this.els.btnCloseReader.addEventListener('click', () => this.closeReader());
        }
        if (this.els.btnRecentBooks) {
            this.els.btnRecentBooks.addEventListener('click', () => this.switchWelcomeView('recent'));
        }
        if (this.els.btnUpload) {
            this.els.btnUpload.addEventListener('click', () => {
                this.switchWelcomeView('explorer');
                this.els.fileInput.click();
            });
        }
        if (this.els.btnGDrive && this.gdrive) {
            this.els.btnGDrive.addEventListener('click', () => {
                this.switchWelcomeView('explorer');
                this.gdrive.handleAuthClick();
            });
        }

        window.addEventListener('popstate', (e) => {
            if (document.body.classList.contains('reading-mode')) {
                if (!e.state || e.state.reading !== true) {
                    this.closeReader(true);
                }
            }
        });

        document.body.addEventListener('UpdateSyncStatus', (e) => {
            this.updateSyncStatus(e.detail.status, e.detail.message);
        });

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

        document.body.addEventListener('ReadingOver', (e) => {
            const percent = (e.detail.prog * 100).toFixed(3);
            this.els.pageIndicator.textContent = `${percent}%`;
            this.els.progressSlider.value = percent;
        });

        this.els.fileInput.addEventListener('change', (e) => { if (e.target.files.length) this.handleFile(e.target.files[0]); });
        this.els.progressSlider.addEventListener('input', (e) => { this.els.pageIndicator.textContent = `${parseFloat(e.target.value).toFixed(3)}%`; });
        this.els.progressSlider.addEventListener('change', (e) => {
            if (!this.currentBook) return;
            const target = this.readingPanel.maxScroll * (parseFloat(e.target.value) / 100);
            this.readingPanel.setScrollOffset(target);
            this.saveProgress();
        });

        // Drop zone events
        this.els.dropZone.addEventListener('dragover', (e) => { e.preventDefault(); this.els.dropZone.classList.add('dragover'); });
        this.els.dropZone.addEventListener('dragleave', () => this.els.dropZone.classList.remove('dragover'));
        this.els.dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            this.els.dropZone.classList.remove('dragover');
            if (e.dataTransfer.files.length) this.handleFile(e.dataTransfer.files[0]);
        });

        window.addEventListener('resize', () => {
            if (!this.currentBook) return;
            const currentPercent = this.readingPanel.maxScroll > 0 ? this.readingPanel.scrollOffset / this.readingPanel.maxScroll : 0;
            this.readingPanel.resize();
            this.rebuildAndShow(0);
            const targetScroll = this.readingPanel.maxScroll * currentPercent;
            this.readingPanel.setScrollOffset(this.readingPanel.snapToGrid(targetScroll));
        });

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                this.checkAndSyncCloudProgress();
            } else if (this.readingLog) {
                this.readingLog.resetInit();
            }
        });
        window.addEventListener('focus', () => this.checkAndSyncCloudProgress());
        window.addEventListener('online', () => this.checkAndSyncCloudProgress());
    }
}

document.addEventListener('DOMContentLoaded', () => { window.readerApp = new ZenReaderApp(); });
