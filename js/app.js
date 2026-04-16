class ZenReaderApp {
    constructor() {
        // State
        this.currentFontSize = 18;
        this.currentWritingMode = 'horizontal';
        this.currentFontFamily = 'sans-serif';
        this.currentLineHeight = 1.8;
        this.currentBookContent = "";
        this.pageOffsets = [0]; 
        this.currentPageIndex = 0;
        this.savedPositions = {}; 
        
        // Touch Quadrants
        this.quadTL = 'prev';
        this.quadTR = 'next';
        this.quadBL = 'prev';
        this.quadBR = 'next';

        this.STATE_KEY = 'zen_reader_state';

        // Ensure dependencies are loaded
        if (!window.ZenDB || !window.ZenEngine) {
            console.error("Required module classes (ZenDB, ZenEngine) are missing!");
            return;
        }

        // Initialize internal modules
        this.db = new window.ZenDB();
        
        this.initDOM();
        this.engine = new window.ZenEngine(this.els.canvas, this.els.ctx);
        
        // Settings Dialog module
        if (window.ZenSettings) {
             this.settings = new window.ZenSettings(this);
        }

        this.bindEvents();
        this.loadState();
    }

    initDOM() {
        this.els = {
            dropZone: document.getElementById('drop-zone'),
            fileInput: document.getElementById('file-input'),
            btnUpload: document.getElementById('btn-upload'),
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
                if (state.positions) {
                    this.savedPositions = state.positions;
                }
                if (state.quadTL) this.quadTL = state.quadTL;
                if (state.quadTR) this.quadTR = state.quadTR;
                if (state.quadBL) this.quadBL = state.quadBL;
                if (state.quadBR) this.quadBR = state.quadBR;
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
            const charIndex = this.pageOffsets[this.currentPageIndex] || 0;
            this.savedPositions[title] = charIndex;
            this.saveState({ positions: this.savedPositions });
        }
    }

    rebuildAndShow(targetCharIndex) {
        if (!this.currentBookContent) return;
        this.pageOffsets = [0];
        let curr = 0;
        let pIndex = 0;
        
        // Fast-forward layout to target
        if (targetCharIndex > 0) {
            while (true) {
                const { nextIndex } = this.engine.layoutPage(this.currentBookContent, curr, this.currentFontSize, this.currentWritingMode, this.currentLineHeight, this.currentFontFamily);
                if (nextIndex <= curr) break; // Avoid infinite error
                
                // If the natural page boundary surpasses our target, we force an exact cut at the target
                if (nextIndex > targetCharIndex) {
                    if (curr !== targetCharIndex) {
                        this.pageOffsets.push(targetCharIndex);
                        pIndex++;
                    }
                    break;
                }
                
                curr = nextIndex;
                this.pageOffsets.push(curr);
                pIndex++;
            }
        }
        
        this.currentPageIndex = pIndex;
        this.showPage(this.currentPageIndex);
    }

    showPage(index) {
        if (!this.currentBookContent) return;
        
        const startIndex = this.pageOffsets[index];
        if (startIndex === undefined) return;
        
        const { nextIndex, drawOps } = this.engine.layoutPage(this.currentBookContent, startIndex, this.currentFontSize, this.currentWritingMode, this.currentLineHeight, this.currentFontFamily);
        this.engine.drawOperations(drawOps, this.currentFontSize, this.currentWritingMode, this.currentFontFamily);
        
        if (index === this.pageOffsets.length - 1 && nextIndex < this.currentBookContent.length && nextIndex > startIndex) {
            this.pageOffsets.push(nextIndex);
        }
        
        const percent = ((startIndex / this.currentBookContent.length) * 100).toFixed(3);
        this.els.pageIndicator.textContent = `${percent}%`;
        this.els.progressSlider.value = percent;
        
        this.els.statusBar.classList.remove('hidden');
    }

    applyLayoutChange() {
        if (!this.currentBookContent) return;
        const currentCharIndex = this.pageOffsets[this.currentPageIndex] || 0;
        this.rebuildAndShow(currentCharIndex);
        this.saveProgress();
    }

    loadBookIntoReader(filename, content) {
        this.currentBookContent = content;
        this.els.documentTitle.textContent = filename;
        
        document.body.classList.add('reading-mode');
        if (window.innerWidth <= 768) {
            document.body.classList.add('ui-hidden');
        }

        this.els.dropZone.classList.add('hidden');
        this.els.readerContainer.classList.remove('hidden');
        this.els.headerCenter.classList.remove('hidden');
        
        this.resizeCanvas();
        
        const targetChar = this.savedPositions[filename] || 0;
        this.rebuildAndShow(targetChar);
    }

    async handleFile(file) {
        if (!file) return;
        this.els.dropZone.classList.add('hidden');
        this.els.readerContainer.classList.remove('hidden');
        this.els.headerCenter.classList.remove('hidden');
        this.els.documentTitle.textContent = "載入中...";
        
        const reader = new FileReader();
        reader.onload = async (e) => {
            const content = e.target.result;
            await this.db.saveBook(file.name, content);
            this.loadBookIntoReader(file.name, content);
        };
        reader.readAsText(file);
    }

    showToast(msg) {
        const toast = document.getElementById('toast');
        toast.textContent = msg;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }

    // Public Setters for Options Dialog
    setTheme(newTheme) {
        document.documentElement.setAttribute('data-theme', newTheme);
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

    setQuad(pos, action) {
        this[`quad${pos}`] = action;
        const stateUpdate = {};
        stateUpdate[`quad${pos}`] = action;
        this.saveState(stateUpdate);
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

            if (action === 'prev') {
                if (this.currentPageIndex > 0) {
                    this.currentPageIndex--;
                    this.showPage(this.currentPageIndex);
                    this.saveProgress();
                }
            } else if (action === 'next') {
                if (this.currentPageIndex < this.pageOffsets.length - 1 || this.pageOffsets[this.pageOffsets.length - 1] < this.currentBookContent.length) {
                    this.currentPageIndex++;
                    this.showPage(this.currentPageIndex);
                    this.saveProgress();
                }
            }
        });

        window.addEventListener('resize', () => {
            if (!this.currentBookContent) return;
            const currentCharIndex = this.pageOffsets[this.currentPageIndex] || 0;
            this.resizeCanvas();
            this.rebuildAndShow(currentCharIndex);
        });

        this.els.progressSlider.addEventListener('input', (e) => {
            this.els.pageIndicator.textContent = `${parseFloat(e.target.value).toFixed(3)}%`;
        });

        this.els.progressSlider.addEventListener('change', (e) => {
            if (!this.currentBookContent) return;
            const percent = parseFloat(e.target.value);
            let targetChar = Math.floor(this.currentBookContent.length * (percent / 100));
            
            if (targetChar < 0) targetChar = 0;
            if (targetChar >= this.currentBookContent.length) targetChar = this.currentBookContent.length - 1;
            
            this.els.pageIndicator.textContent = "跳轉中...";
            
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    this.rebuildAndShow(targetChar);
                    this.saveProgress();
                });
            });
        });

        this.els.btnCloseReader.addEventListener('click', async () => {
            document.body.classList.remove('reading-mode');
            document.body.classList.remove('ui-hidden');
            this.els.readerContainer.classList.add('hidden');
            this.els.headerCenter.classList.add('hidden');
            this.els.dropZone.classList.remove('hidden');
            this.els.documentTitle.textContent = '';
            this.currentBookContent = '';
            this.els.fileInput.value = '';
            this.pageOffsets = [0];
            this.currentPageIndex = 0;
            this.els.ctx.clearRect(0, 0, this.els.canvas.width, this.els.canvas.height); 
            await this.db.deleteBook();
        });

        this.els.btnUpload.addEventListener('click', () => this.els.fileInput.click());
        
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

        window.addEventListener('online', () => this.showToast('已恢復網路連線'));
        window.addEventListener('offline', () => this.showToast('目前處於離線模式'));
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Export instance to window for global debugging if needed
    window.readerApp = new ZenReaderApp();
});
