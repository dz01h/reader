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

        // Load and apply saved configuration
        this.loadState();

        const finput = document.getElementById('file-input');
        if (finput) {
            finput.addEventListener('change', (e) => {
                const fileInput = e.target;
                if (!fileInput || !fileInput.files || fileInput.files.length === 0) return;

                const reader = new FileReader();
                reader.onload = (e) => {
                    const textContent = e.target.result;
                    console.log("Loaded text content:", textContent.length, 'words', textContent.substring(0, 100));
                    document.body.dispatchEvent(new CustomEvent('ReadingOperation', { detail: {
                        action: 'read',
                        params: [new ReadingDocument(textContent)]
                    } }));
                };
                reader.readAsText(fileInput.files[0]);
            });
        }
    }

    logError(msg) {
        try {
            let logs = JSON.parse(localStorage.getItem('zen_app_error_log') || '[]');
            logs.unshift(`[${new Date().toLocaleString()}] ${msg}`);
            if (logs.length > 50) logs = logs.slice(0, 50);
            localStorage.setItem('zen_app_error_log', JSON.stringify(logs));
        } catch(e) {}
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
            currentChapterDisplay: document.getElementById('current-chapter-display'),

            statusBar: document.getElementById('status-bar'),
            progressSlider: document.getElementById('progress-slider'),
            sliderTooltip: document.getElementById('slider-tooltip'),
            pageIndicator: document.getElementById('page-indicator'),
            btnTocToggle: document.getElementById('btn-toc-toggle'),
            tocDialog: document.getElementById('toc-dialog'),
            tocList: document.getElementById('toc-list'),
        };
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

    loadConfig() {
        return this.loadState();
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

        const readingPanel = document.querySelector('reading-panel');
        if (readingPanel && typeof readingPanel.updateConfig === 'function') {
            readingPanel.updateConfig({
                fontSize: this.fontSize,
                fontFamily: this.fontFamily,
                lineHeightRatio: this.lineHeight,
                margins: this.margins,
                writingMode: this.writingMode,
                wordSpacing: this.wordSpacing
            });
        }
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
            this.fontSize,
            this.writingMode,
            cw, ch,
            this.lineHeight,
            this.fontFamily,
            this.margins
        );

        this.readingPanel.setLayout(drawOps, maxScroll, targetScroll);
        this.calculateTOCPositions();
        this.els.statusBar.classList.remove('hidden');
    }

    calculateTOCPositions() {
        if (!this.toc || this.toc.length === 0 || !this.readingPanel || !this.readingPanel.drawOps) return;
        const ops = this.readingPanel.drawOps;
        if (ops.length === 0) return;

        const firstOp = ops[0];
        const startX = firstOp ? firstOp.x : 0;
        const startY = firstOp ? firstOp.y : 0;

        for (let i = 0; i < this.toc.length; i++) {
            const chapter = this.toc[i];

            let l = 0, r = ops.length - 1;
            let ans = 0;
            while (l <= r) {
                const mid = (l + r) >> 1;
                if (ops[mid].charIndex >= chapter.charIndex) {
                    ans = mid;
                    r = mid - 1;
                } else {
                    l = mid + 1;
                }
            }

            const op = ops[ans];
            if (op) {
                let offset = 0;
                if (this.writingMode === 'vertical') {
                    offset = startX - op.x;
                } else {
                    offset = op.y - startY;
                }

                offset = Math.max(0, Math.min(offset, this.readingPanel.maxScroll));
                chapter.percent = this.readingPanel.maxScroll > 0 ? offset / this.readingPanel.maxScroll : 0;
            }
        }
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
        this.saveState({ lastBookId: book.filename });
        this.els.documentTitle.textContent = book.filename;

        if (book.content) {
            this.parseTOC(book.content);
        }

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

    parseTOC(text) {
        this.toc = [];
        const tocRegex = /^\s*(第[零一二三四五六七八九十百千萬0-9０-９]+[章回節卷]|Chapter\s*[0-9]+|正文|楔子|前言|番外)/i;
        const lines = text.split('\n');
        let charIndex = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.length < 50 && tocRegex.test(line)) {
                this.toc.push({
                    title: line.trim(),
                    charIndex: charIndex,
                    percent: charIndex / text.length
                });
            }
            charIndex += line.length + 1; // +1 for newline
        }
        this.renderTOC();
    }

    renderTOC() {
        if (!this.els.tocList) return;
        this.els.tocList.innerHTML = '';
        if (this.toc.length === 0) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'toc-item';
            emptyEl.style.opacity = '0.5';
            emptyEl.textContent = '無章節資訊';
            this.els.tocList.appendChild(emptyEl);
            return;
        }

        this.toc.forEach(chapter => {
            const el = document.createElement('div');
            el.className = 'toc-item';
            el.textContent = chapter.title;
            el.addEventListener('click', () => {
                this.els.tocDialog.classList.add('hidden');
                this.readingPanel.setScrollOffset(this.readingPanel.maxScroll * chapter.percent);
                this.saveProgress();
                this.updateCurrentChapterDisplay();
            });
            this.els.tocList.appendChild(el);
        });
    }

    updateCurrentChapterDisplay() {
        if (!this.currentBook || !this.toc || this.toc.length === 0) {
            if (this.els.currentChapterDisplay) this.els.currentChapterDisplay.textContent = '';
            if (this.els.sliderTooltip) this.els.sliderTooltip.classList.add('hidden');
            return;
        }

        const currentPercent = this.readingPanel.maxScroll > 0 ? this.readingPanel.scrollOffset / this.readingPanel.maxScroll : 0;
        const bufferPixels = (this.fontSize || 18) * (this.lineHeight || 1.8) * 2;
        const percentBuffer = this.readingPanel.maxScroll > 0 ? bufferPixels / this.readingPanel.maxScroll : 0;

        let currentChapter = this.toc[0].title;
        for (let i = this.toc.length - 1; i >= 0; i--) {
            if (currentPercent >= this.toc[i].percent - percentBuffer) {
                currentChapter = this.toc[i].title;
                break;
            }
        }

        if (this.els.currentChapterDisplay) {
            this.els.currentChapterDisplay.textContent = currentChapter;
        }

        if (this.els.sliderTooltip && !this.els.sliderTooltip.classList.contains('hidden')) {
            this.els.sliderTooltip.textContent = currentChapter;
        }
    }

    async closeReader(isFromHistory = false) {
        if (!this.els) return;
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

        const opfsFiles = await window.ZenOPFS.listFiles();
        if (!opfsFiles || opfsFiles.length === 0) {
            container.classList.add('hidden');
            return;
        }

        container.classList.remove('hidden');
        grid.innerHTML = '';

        // Load progress from localStorage
        const savedState = localStorage.getItem('zen_reader_state');
        const state = savedState ? JSON.parse(savedState) : {};
        const positions = state.positions || {};

        opfsFiles.forEach(meta => {
            const card = document.createElement('div');
            card.className = 'recent-book-card';
            card.style.position = 'relative';

            const date = new Date(meta.lastModified);
            const dateString = `${date.getMonth()+1}/${date.getDate()} ${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}`;

            const bookProgressData = positions[meta.name];
            const progressPercent = bookProgressData ? Math.round((bookProgressData.progress || 0) * 100) : 0;

            card.innerHTML = `
                <div class="recent-book-title" title="${meta.name}">${meta.name}</div>
                <div class="recent-book-meta">
                    <span>${progressPercent}%</span>
                    <span>${dateString}</span>
                </div>
                <div class="recent-book-actions" style="position: absolute; bottom: 8px; right: 8px; display: flex; gap: 4px;">
                    <button class="btn-download" title="下載" style="background:none;border:none;cursor:pointer;padding:4px;color:#cbd5e1;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                    </button>
                    <button class="btn-delete" title="刪除" style="background:none;border:none;cursor:pointer;padding:4px;color:#f87171;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                </div>
            `;

            // Hover effects for actions
            card.addEventListener('mouseenter', () => card.querySelector('.recent-book-actions').style.opacity = '1');
            card.addEventListener('mouseleave', () => card.querySelector('.recent-book-actions').style.opacity = '0');
            card.querySelector('.recent-book-actions').style.opacity = '0';
            card.querySelector('.recent-book-actions').style.transition = 'opacity 0.2s';

            // Delete action
            const btnDelete = card.querySelector('.btn-delete');
            btnDelete.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (confirm(`確定要刪除 ${meta.name} 嗎？`)) {
                    await window.ZenOPFS.deleteFile(meta.name);
                    this.renderRecentBooks();
                }
            });

            // Download action
            const btnDownload = card.querySelector('.btn-download');
            btnDownload.addEventListener('click', async (e) => {
                e.stopPropagation();
                await window.ZenOPFS.downloadFile(meta.name);
            });

            // Open action
            card.addEventListener('click', async () => {
                const text = await window.ZenOPFS.loadFile(meta.name);
                if (text) {
                    const book = new window.ZenBook(meta.name, text);
                    book.loadProgress();
                    this.loadBookIntoReader(book);
                } else {
                    this.showToast('無法讀取檔案');
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

        el.classList.remove('hidden', 'syncing', 'success', 'error', 'offline');
        el.style.cursor = '';
        el.onclick = null;

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

            if (message === 'Auth failed') {
                msgEl.textContent = '憑證過期，點此重新授權';
                el.style.cursor = 'pointer';
                el.onclick = () => {
                    if (this.gdrive) {
                        this.gdrive.handleAuthClick(true).then(() => this.checkAndSyncCloudProgress());
                    }
                };
                this.logError(`Sync failed: Auth failed`);
            } else {
                msgEl.textContent = message || (this.i18n ? this.i18n.t('syncError') : 'Sync failed');
                this.logError(`Sync failed: ${message}`);
            }
        } else if (status === 'offline') {
            el.classList.add('offline');
            timeEl.textContent = new Date().toLocaleTimeString();
            msgEl.textContent = message || '已離線';
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
        const toast = document.getElementById('toast');
        if (!toast) return;
        toast.textContent = msg;
        toast.classList.add('show');
        if (this.toastTimeout) clearTimeout(this.toastTimeout);
        if (duration > 0) {
            this.toastTimeout = setTimeout(() => toast.classList.remove('show'), duration);
        }
    }

    hideToast() {
        const toast = document.getElementById('toast');
        if (toast) toast.classList.remove('show');
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
        } else {
            // User rejected remote progress. Force overwrite the cloud with current local progress.
            if (this.readingLog) {
                // Force update bypassing optimistic concurrency check
                this.readingLog.updateSheetProgress(
                    this.currentBook.filename,
                    localProg,
                    new Date().toISOString(),
                    true
                );
                this.showToast('已保留本機進度並覆寫雲端');
            }
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
            this.updateCurrentChapterDisplay();
        });

        this.els.fileInput.addEventListener('change', (e) => { if (e.target.files.length) this.handleFile(e.target.files[0]); });
        this.els.progressSlider.addEventListener('input', (e) => {
            this.els.pageIndicator.textContent = `${parseFloat(e.target.value).toFixed(3)}%`;

            // Show tooltip
            if (this.els.sliderTooltip && this.toc && this.toc.length > 0) {
                this.els.sliderTooltip.classList.remove('hidden');
                const val = e.target.value;

                // Find chapter for this percent
                let currentChapter = this.toc[0].title;
                const currentDecimal = val / 100;
                const bufferPixels = (this.fontSize || 18) * (this.lineHeight || 1.8) * 2;
                const percentBuffer = this.readingPanel.maxScroll > 0 ? bufferPixels / this.readingPanel.maxScroll : 0;

                for (let i = this.toc.length - 1; i >= 0; i--) {
                    if (currentDecimal >= this.toc[i].percent - percentBuffer) {
                        currentChapter = this.toc[i].title;
                        break;
                    }
                }
                this.els.sliderTooltip.textContent = currentChapter;
            }
        });

        // Hide tooltip when interaction ends
        this.els.progressSlider.addEventListener('change', (e) => {
            if (this.els.sliderTooltip) {
                this.els.sliderTooltip.classList.add('hidden');
            }
            if (!this.currentBook) return;
            const target = this.readingPanel.maxScroll * (parseFloat(e.target.value) / 100);
            this.readingPanel.setScrollOffset(target);
            this.saveProgress();
            this.updateCurrentChapterDisplay();
        });

        if (this.els.btnTocToggle && this.els.tocDialog) {
            this.els.btnTocToggle.addEventListener('click', () => {
                this.els.tocDialog.classList.toggle('hidden');
            });

            // Close dialog when clicking outside
            document.addEventListener('click', (e) => {
                if (!this.els.tocDialog.contains(e.target) && !this.els.btnTocToggle.contains(e.target)) {
                    this.els.tocDialog.classList.add('hidden');
                }
            });
        }

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
            this.updateCurrentChapterDisplay();
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

window.ZenReaderApp = ZenReaderApp;
document.addEventListener('DOMContentLoaded', () => { window.readerApp = new ZenReaderApp(); });
