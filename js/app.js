class ZenReaderApp {
    constructor() {
        // State
        this.currentFontSize = 18;
        this.currentWritingMode = 'horizontal';
        this.currentFontFamily = 'sans-serif';
        this.currentLineHeight = 1.8;
        this.margins = { top: 30, bottom: 30, left: 30, right: 30 };
        this.currentBookContent = '';
        this.drawOps = [];
        this.scrollOffset = 0;
        this.maxScroll = 0;
        
        // Touch Drag State
        this.isDragging = false;
        this.lastDragCoord = 0;
        this.velocity = 0;
        this.lastTime = 0;
        this.inertiaFrameId = null;

        this.pageOffsets = [0]; // fallback safely removed later
        this.currentPageIndex = 0;
        this.savedPositions = {}; 
        
        // Touch Quadrants
        this.quadTL = 'prev';
        this.quadTR = 'next';
        this.quadBL = 'prev';
        this.quadBR = 'next';
        
        this.syncCooldown = 15; // default 15 minutes
        this.lastSyncTime = 0;
        
        this.STATE_KEY = 'zen_reader_state';

        // Ensure dependencies are loaded
        if (!window.ZenDB || !window.ZenEngine) {
            console.error("Required module classes (ZenDB, ZenEngine) are missing!");
            return;
        }

        // Initialize internal modules
        if (window.I18n) {
            this.i18n = new window.I18n();
        }
        
        this.db = new window.ZenDB();
        
        this.initDOM();
        this.engine = new window.ZenEngine(this.els.canvas, this.els.ctx);
        
        // Settings Dialog module
        if (window.ZenSettings) {
             this.settings = new window.ZenSettings(this);
        }
        
        // File Explorer module
        if (window.FileExplorer) {
             this.explorer = new window.FileExplorer(this);
        }
        
        // GDrive module
        if (window.ZenGDrive) {
             this.gdrive = new window.ZenGDrive(this);
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
            dropZone: document.getElementById('welcome-screen'), // Treat the whole welcome screen as the dropzone/landing page
            fileInput: document.getElementById('file-input'),
            btnUpload: document.getElementById('btn-upload'),
            btnGDrive: document.getElementById('btn-gdrive'),
            readerContainer: document.getElementById('reader-container'),
            documentTitle: document.getElementById('document-title'),
            canvas: document.getElementById('reader-canvas'),
            ctx: document.getElementById('reader-canvas').getContext('2d'),
            
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
                
                if (state.fontSize) {
                    this.currentFontSize = state.fontSize;
                }
                if (state.writingMode) {
                    this.currentWritingMode = state.writingMode;
                    document.documentElement.setAttribute('data-writing-mode', this.currentWritingMode);
                }
                if (state.fontFamily) {
                    this.currentFontFamily = state.fontFamily;
                }
                if (state.lineHeight) {
                    this.currentLineHeight = state.lineHeight;
                }
                if (state.margins) {
                    this.margins = state.margins;
                } else if (state.margin !== undefined) {
                    this.margins = { top: state.margin, bottom: state.margin, left: state.margin, right: state.margin };
                }
                if (state.positions) {
                    this.savedPositions = state.positions;
                }
                if (state.quadTL) this.quadTL = state.quadTL;
                if (state.quadTR) this.quadTR = state.quadTR;
                if (state.quadBL) this.quadBL = state.quadBL;
                if (state.quadBR) this.quadBR = state.quadBR;
                
                if (state.syncCooldown) this.syncCooldown = state.syncCooldown;
                
                if (state.lang && this.i18n) {
                    this.i18n.setLanguage(state.lang);
                } else if (this.i18n) {
                    this.i18n.updateDOM();
                }

            } catch (e) {
                console.error("Local storage error:", e);
            }
        } else {
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
        }

        const book = await this.db.loadBook();
        if (book && book.content && book.content.length > 0) {
            this.loadBookIntoReader(book.filename, book.content);
            this.showToast(`已載入上次閱讀的書籍`);
        }
        
        this.updateThemeColor();
    }

    async closeReader() {
        document.body.classList.remove('reading-mode');
        document.body.classList.remove('ui-hidden');
        this.updateThemeColor();
        this.els.readerContainer.classList.add('hidden');
        this.els.headerCenter.classList.add('hidden');
        this.els.dropZone.classList.remove('hidden');
        this.els.statusBar.classList.add('hidden'); 
        this.els.documentTitle.textContent = '';
        this.currentBookContent = '';
        this.els.fileInput.value = '';
        
        this.scrollOffset = 0;
        this.drawOps = [];
        this.maxScroll = 0;
        
        this.els.ctx.clearRect(0, 0, this.els.canvas.width, this.els.canvas.height); 
        await this.db.deleteBook();
    }

    resizeCanvas() {
        this.els.canvas.style.width = '100%'; 
        this.els.canvas.style.height = '100%'; 
        const rect = this.els.canvas.getBoundingClientRect();
        
        const width = rect.width;
        const height = rect.height;

        // Force minimum 2x scaling for ultimate retina crispness, overriding 1x displays.
        const dpr = Math.max(window.devicePixelRatio || 1, 2);
        this.els.canvas.width = width * dpr;
        this.els.canvas.height = height * dpr;
        
        this.els.ctx.setTransform(1, 0, 0, 1, 0, 0); 
        this.els.ctx.scale(dpr, dpr);
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
        const title = this.els.documentTitle.textContent;
        if (title && this.currentBookContent) {
            const now = Date.now();
            // Store as object with position and UTC ISO timestamp
            this.savedPositions[title] = {
                pos: this.scrollOffset,
                ts: new Date(now).toISOString()
            };
            this.saveState({ positions: this.savedPositions });

            // Remote sync with cooldown
            const cooldownMs = this.syncCooldown * 60 * 1000;
            if (now - this.lastSyncTime > cooldownMs) {
                this.performRemoteSync(title, this.scrollOffset);
                this.lastSyncTime = now;
            }
        }
    }

    performRemoteSync(filename, offset) {
        if (!this.gdrive) return;
        const progress = this.maxScroll > 0 ? offset / this.maxScroll : 0;
        const timestamp = new Date().toISOString();
        this.gdrive.updateSheetProgress(filename, progress, timestamp);
    }

    rebuildAndShow(targetScroll = 0) {
        if (!this.currentBookContent) return;
        
        const rect = this.els.canvas.getBoundingClientRect();
        const cw = rect.width;
        const ch = rect.height;
        
        const { drawOps, maxScroll } = this.engine.layoutDocument(
            this.currentBookContent,
            this.currentFontSize,
            this.currentWritingMode,
            cw, ch,
            this.currentLineHeight,
            this.currentFontFamily,
            this.margins
        );
        
        this.drawOps = drawOps;
        this.maxScroll = maxScroll;
        this.scrollOffset = Math.max(0, Math.min(targetScroll, maxScroll));
        
        this.renderCanvas();
        this.els.statusBar.classList.remove('hidden');
    }

    renderCanvas() {
        if (!this.currentBookContent) return;
        if (this.scrollOffset < 0) this.scrollOffset = 0;
        if (this.scrollOffset > this.maxScroll) this.scrollOffset = this.maxScroll;
        
        const rect = this.els.canvas.getBoundingClientRect();
        const cw = rect.width;
        const ch = rect.height;
        
        this.engine.drawOperations(
            this.drawOps, 
            this.scrollOffset, 
            this.currentFontSize, 
            this.currentWritingMode, 
            cw, ch, 
            this.currentFontFamily
        );
        
        const percent = this.maxScroll > 0 ? ((this.scrollOffset / this.maxScroll) * 100).toFixed(3) : 0;
        this.els.pageIndicator.textContent = `${percent}%`;
        this.els.progressSlider.value = percent;
    }

    applyLayoutChange() {
        if (!this.currentBookContent) return;
        const currentPercent = this.maxScroll > 0 ? this.scrollOffset / this.maxScroll : 0;
        this.rebuildAndShow(0);
        this.scrollOffset = this.maxScroll * currentPercent;
        this.renderCanvas();
        this.saveProgress();
    }

    loadBookIntoReader(filename, content) {
        this.currentBookContent = content;
        this.els.documentTitle.textContent = filename;
        
        document.body.classList.add('reading-mode');
        // Start with UI visible, user will tap to hide
        document.body.classList.remove('ui-hidden');
        this.updateThemeColor();

        this.els.dropZone.classList.add('hidden');
        this.els.readerContainer.classList.remove('hidden');
        this.els.headerCenter.classList.remove('hidden');
        
        this.resizeCanvas();
        
        const savedData = this.savedPositions[filename] || 0;
        // Support both old format (number) and new format (object {pos, ts})
        const targetChar = (typeof savedData === 'object' && savedData !== null) ? (savedData.pos || 0) : savedData;
        
        this.rebuildAndShow(targetChar);

        // Check remote progress using Google Sheets directly
        if (this.gdrive) {
            const localProg = this.maxScroll > 0 ? targetChar / this.maxScroll : 0;
            const localTs = (typeof savedData === 'object' && savedData !== null) ? savedData.ts : 0;
            this.gdrive.syncSheetProgress(filename, localProg, localTs).then(remote => {
                if (remote) {
                    this.handleRemoteProgress(remote);
                }
            });
        }
    }

    handleRemoteProgress(remote) {
        if (!remote || remote.progress === undefined) return;
        
        const remotePercent = (remote.progress * 100).toFixed(3);
        const msg = this.i18n ? 
            `發現更晚的雲端進度 (${remotePercent}%)，是否同步？` : 
            `Newer remote progress found (${remotePercent}%), sync now?`;
        
        if (confirm(msg)) {
            // Convert percentage to scroll offset
            const targetScroll = remote.progress * this.maxScroll;
            this.rebuildAndShow(targetScroll);
            // Save local with remote's time to prevent re-prompting
            const filename = this.els.documentTitle.textContent;
            this.savedPositions[filename] = {
                pos: this.scrollOffset,
                ts: remote.time
            };
            this.saveState({ positions: this.savedPositions });
        }
    }

    async handleFile(file) {
        if (!file) return;
        
        if (file.name.toLowerCase().endsWith('.zip')) {
            if (this.zipHandler) {
                this.zipHandler.processZip(file, file.name);
            } else {
                this.showToast('ZIP 處理模組尚未載入！');
            }
            return;
        }

        this.els.dropZone.classList.add('hidden');
        this.els.readerContainer.classList.remove('hidden');
        this.els.headerCenter.classList.remove('hidden');
        this.els.documentTitle.textContent = "載入中...";
        
        const reader = new FileReader();
        reader.onload = async (e) => {
            const buffer = e.target.result;
            const text = this.decodeText(new Uint8Array(buffer));
            await this.db.saveBook(file.name, text);
            this.loadBookIntoReader(file.name, text);
        };
        reader.readAsArrayBuffer(file);
    }

    showToast(msg, duration = 3000) {
        const toast = document.getElementById('toast');
        toast.textContent = msg;
        toast.classList.add('show');
        if (this.toastTimeout) clearTimeout(this.toastTimeout);
        if (duration > 0) {
            this.toastTimeout = setTimeout(() => toast.classList.remove('show'), duration);
        }
    }

    updateThemeColor() {
        const theme = document.documentElement.getAttribute('data-theme') || 'light';
        // Match the background colors from CSS: Light: #f9f9fb, Dark: #0f172a
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

    decodeText(uint8array) {
        // Check for BOMs (Byte Order Marks)
        if (uint8array.length >= 2) {
            // UTF-16 LE
            if (uint8array[0] === 0xFF && uint8array[1] === 0xFE) {
                return new TextDecoder('utf-16le').decode(uint8array);
            }
            // UTF-16 BE
            if (uint8array[0] === 0xFE && uint8array[1] === 0xFF) {
                return new TextDecoder('utf-16be').decode(uint8array);
            }
        }
        if (uint8array.length >= 3) {
            // UTF-8 BOM
            if (uint8array[0] === 0xEF && uint8array[1] === 0xBB && uint8array[2] === 0xBF) {
                return new TextDecoder('utf-8').decode(uint8array);
            }
        }

        try {
            // 1. Try decoding strictly as UTF-8
            return new TextDecoder('utf-8', { fatal: true }).decode(uint8array);
        } catch (e) {
            // 2. Fallback based on interface language preference
            let fallbackEnc = 'big5';
            if (this.i18n) {
                if (this.i18n.lang === 'zh-CN') fallbackEnc = 'gbk';
                else if (this.i18n.lang === 'ja-JP') fallbackEnc = 'shift-jis';
                else if (this.i18n.lang === 'en-US') fallbackEnc = 'windows-1252';
            }
            
            console.warn(`UTF-8 decoding failed, falling back to ${fallbackEnc} ...`);
            try {
                return new TextDecoder(fallbackEnc, { fatal: true }).decode(uint8array);
            } catch(e2) {
                // 3. Last resort ignoring invalid characters
                return new TextDecoder(fallbackEnc).decode(uint8array);
            }
        }
    }

    // Public Setters for Options Dialog
    setTheme(newTheme) {
        document.documentElement.setAttribute('data-theme', newTheme);
        this.updateThemeColor();
        this.saveState({ theme: newTheme });
        if (this.currentBookContent) this.showPage(this.currentPageIndex); 
    }

    setWritingMode(mode) {
        this.currentWritingMode = mode;
        document.documentElement.setAttribute('data-writing-mode', this.currentWritingMode);
        this.saveState({ writingMode: this.currentWritingMode });
        this.applyLayoutChange();
    }

    setFontSize(size) {
        this.currentFontSize = size;
        this.saveState({ fontSize: this.currentFontSize });
        this.applyLayoutChange();
    }

    setFontFamily(family) {
        this.currentFontFamily = family;
        this.saveState({ fontFamily: this.currentFontFamily });
        this.applyLayoutChange();
    }

    setLineHeight(ratio) {
        this.currentLineHeight = ratio;
        this.saveState({ lineHeight: this.currentLineHeight });
        this.applyLayoutChange();
    }

    setMargins(updates) {
        this.margins = { ...this.margins, ...updates };
        this.saveState({ margins: this.margins });
        this.applyLayoutChange();
    }

    setQuad(quad, action) {
        this[`quad${quad}`] = action;
        const update = {};
        update[`quad${quad}`] = action;
        this.saveState(update);
    }

    setSyncCooldown(minutes) {
        this.syncCooldown = parseInt(minutes);
        this.saveState({ syncCooldown: this.syncCooldown });
    }
    

    setLanguage(langCode) {
        if (this.i18n && this.i18n.setLanguage(langCode)) {
            this.saveState({ lang: langCode });
            
            const fontSizeDisplay = document.getElementById('setting-font-size-display');
            if (fontSizeDisplay) fontSizeDisplay.textContent = this.currentFontSize + 'px';
            const lineHeightDisplay = document.getElementById('setting-line-height-display');
            if (lineHeightDisplay) lineHeightDisplay.textContent = this.currentLineHeight;
        }
    }
    
    handleURLSync() {
        const urlParams = new URLSearchParams(window.location.search);
        const syncPayload = urlParams.get('sync');
        if (syncPayload) {
            try {
                const state = JSON.parse(atob(syncPayload));
                
                if (state.lang) {
                    this.setLanguage(state.lang);
                }
                if (state.theme) {
                    this.setTheme(state.theme);
                }
                if (state.fontSize) this.setFontSize(state.fontSize);
                if (state.lineHeight) this.setLineHeight(state.lineHeight);
                if (state.margins) {
                    this.setMargins(state.margins);
                } else if (state.margin !== undefined) {
                    this.setMargins({ top: state.margin, bottom: state.margin, left: state.margin, right: state.margin });
                }
                
                this.showToast(this.i18n ? this.i18n.t('toastReady') || '設定已同步成功！' : '設定同步成功！');
                
                if (this.settings) {
                    this.settings.syncUI();
                }
                
                // Clean the URL immediately without reloading the page
                window.history.replaceState({}, document.title, window.location.pathname);
            } catch (e) {
                console.error('Sync failed:', e);
                this.showToast('同步碼解析失敗');
            }
        }
    }

    bindEvents() {
        // Canvas Quadrant Tap Navigation
        this.els.canvas.addEventListener('click', (e) => {
            if (!this.currentBookContent) return;
            const rect = this.els.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const hw = rect.width / 2;
            const hh = rect.height / 2;

            // Toggle floating UI when tapping the center (approx middle 40%)
            const isMiddleX = x > rect.width * 0.3 && x < rect.width * 0.7;
            const isMiddleY = y > rect.height * 0.3 && y < rect.height * 0.7;

            if (isMiddleX && isMiddleY) {
                document.body.classList.toggle('ui-hidden');
                return;
            }

            // If hitting other quadrants while UI is visible in mobile, hide it first
            if (window.innerWidth <= 768 && !document.body.classList.contains('ui-hidden')) {
                document.body.classList.add('ui-hidden');
                return; 
            }
            
            let action = 'none';
            if (x < hw && y < hh) action = this.quadTL;
            else if (x >= hw && y < hh) action = this.quadTR;
            else if (x < hw && y >= hh) action = this.quadBL;
            else action = this.quadBR;

            const viewAmt = this.currentWritingMode === 'vertical' 
                ? (rect.width - this.margins.left - this.margins.right) 
                : (rect.height - this.margins.top - this.margins.bottom);
            
            // Align page flips perfectly to the line-height grid to prevent cutting text in half
            const gridStep = this.currentFontSize * this.currentLineHeight;
            const maxVisibleLines = Math.max(1, Math.floor(viewAmt / gridStep));
            const baseJump = maxVisibleLines * gridStep;

            if (action === 'prev') {
                const target = Math.round((this.scrollOffset - baseJump) / gridStep) * gridStep;
                this.startInertialScroll(target - this.scrollOffset, 0.4); 
            } else if (action === 'next') {
                const target = Math.round((this.scrollOffset + baseJump) / gridStep) * gridStep;
                this.startInertialScroll(target - this.scrollOffset, 0.4);
            }
        });
        
        // Touch Drag & Scroll Wheel
        this.els.canvas.addEventListener('mousedown', (e) => this.onDragStart(e));
        this.els.canvas.addEventListener('mousemove', (e) => this.onDragMove(e));
        window.addEventListener('mouseup', (e) => this.onDragEnd(e));
        
        this.els.canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) this.onDragStart(e.touches[0]);
        }, { passive: true });
        
        this.els.canvas.addEventListener('touchmove', (e) => {
            if (e.touches.length === 1 && this.isDragging) {
                e.preventDefault(); // Prevents browser scroll
                this.onDragMove(e.touches[0]);
            }
        }, { passive: false });
        window.addEventListener('touchend', (e) => this.onDragEnd(e));

        this.els.canvas.addEventListener('wheel', (e) => {
            if (!this.currentBookContent) return;
            e.preventDefault();
            this.scrollOffset += this.currentWritingMode === 'vertical' ? -e.deltaX + e.deltaY : e.deltaY;
            this.renderCanvas(); // instantly renders without inertia
            // saveProgress omitted from wheel to prevent spamming localStorage, use debounce ideally, or skip for now.
        }, { passive: false });

        window.addEventListener('resize', () => {
            if (!this.currentBookContent) return;
            const currentPercent = this.maxScroll > 0 ? this.scrollOffset / this.maxScroll : 0;
            this.resizeCanvas();
            this.rebuildAndShow(0);
            this.scrollOffset = this.maxScroll * currentPercent;
            this.renderCanvas();
        });

        this.els.progressSlider.addEventListener('input', (e) => {
            this.els.pageIndicator.textContent = `${parseFloat(e.target.value).toFixed(3)}%`;
        });

        this.els.progressSlider.addEventListener('change', (e) => {
            if (!this.currentBookContent) return;
            const percent = parseFloat(e.target.value);
            
            this.els.pageIndicator.textContent = "跳轉中...";
            
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    this.scrollOffset = this.maxScroll * (percent / 100);
                    this.renderCanvas();
                    this.saveProgress();
                });
            });
        });

        this.els.btnCloseReader.addEventListener('click', () => this.closeReader());

        this.els.btnUpload.addEventListener('click', () => {
            if (this.explorer) {
                this.explorer.showEmptyDropHint(); // Reset to empty hint state
            }
            this.els.fileInput.click();
        });
        
        if (this.els.btnGDrive && this.gdrive) {
            this.els.btnGDrive.addEventListener('click', () => this.gdrive.handleAuthClick());
        }

        this.els.fileInput.addEventListener('change', (e) => {
            if (e.target.files.length) this.handleFile(e.target.files[0]);
        });

        this.els.dropZone.addEventListener('dragover', (e) => { e.preventDefault(); this.els.dropZone.classList.add('dragover'); });
        this.els.dropZone.addEventListener('dragleave', () => { this.els.dropZone.classList.remove('dragover'); });
        this.els.dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            this.els.dropZone.classList.remove('dragover');
            if (e.dataTransfer.files.length) this.handleFile(e.dataTransfer.files[0]);
        });

        window.addEventListener('online', () => {
            // Silent sync if currently reading
            // If currently reading, check and sync progress
            if (document.body.classList.contains('reading-mode') && this.gdrive) {
                const filename = this.els.documentTitle.textContent;
                const savedData = this.savedPositions[filename];
                const localProg = this.maxScroll > 0 ? this.scrollOffset / this.maxScroll : 0;
                const localTs = (typeof savedData === 'object' && savedData !== null) ? savedData.ts : 0;

                // Attempt to sync (ensureAuth is called internally)
                this.gdrive.syncSheetProgress(filename, localProg, localTs).then(remote => {
                    if (remote) {
                        this.handleRemoteProgress(remote);
                    } else {
                        // Push local if no conflict
                        this.performRemoteSync(filename, this.scrollOffset);
                    }
                });
            }
        });
        window.addEventListener('offline', () => {}); // Background stay quiet
    }

    onDragStart(e) {
        if (!this.currentBookContent) return;
        this.isDragging = true;
        this.lastDragCoord = this.currentWritingMode === 'vertical' ? e.screenX : e.screenY;
        this.lastTime = performance.now();
        this.velocity = 0;
        if (this.inertiaFrameId) cancelAnimationFrame(this.inertiaFrameId);
    }

    onDragMove(e) {
        if (!this.isDragging || !this.currentBookContent) return;
        const currentCoord = this.currentWritingMode === 'vertical' ? e.screenX : e.screenY;
        // Invert delta: moving finger Up (negative Y delta) means scrollOffset should increase to view text below
        const delta = this.currentWritingMode === 'vertical' ? (currentCoord - this.lastDragCoord) : (this.lastDragCoord - currentCoord);
        
        const now = performance.now();
        const dt = Math.max(1, now - this.lastTime);
        
        // Rolling velocity track (pixels per frame at 60fps)
        this.velocity = (delta / dt) * 16.67; 
        
        this.lastDragCoord = currentCoord;
        this.lastTime = now;
        
        this.scrollOffset += delta;
        this.renderCanvas();
    }

    onDragEnd() {
        if (!this.isDragging) return;
        this.isDragging = false;
        
        if (Math.abs(this.velocity) > 1) {
            this.startInertialScroll(this.velocity * 15, 0.92);
        } else {
            this.saveProgress();
        }
    }

    startInertialScroll(totalDisplacement, friction = 0.95) {
        if (!this.currentBookContent) return;
        if (this.inertiaFrameId) cancelAnimationFrame(this.inertiaFrameId);
        
        let currentV = totalDisplacement * (1 - friction);
        
        const loop = () => {
            if (Math.abs(currentV) < 0.5) {
                this.saveProgress();
                return;
            }
            
            this.scrollOffset += currentV;
            this.renderCanvas();
            
            currentV *= friction;
            
            // Hard bumper hit bounding box
            if (this.scrollOffset < 0 || this.scrollOffset > this.maxScroll) {
                currentV *= 0.5; // Dampen deeply
                if (this.scrollOffset < 0) this.scrollOffset = 0;
                if (this.scrollOffset > this.maxScroll) this.scrollOffset = this.maxScroll;
            }
            
            this.inertiaFrameId = requestAnimationFrame(loop);
        };
        loop();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Export instance to window for global debugging if needed
    window.readerApp = new ZenReaderApp();
});
