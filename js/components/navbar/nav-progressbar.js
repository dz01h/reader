class NavProgressBar extends Component {
    static DEFAULT_STYLE = `
        :host {
            display: block;
            position: relative;
            box-sizing: border-box;
            min-height: 15px;
            border: 2px solid var(--color-border);
            touch-action: none;
            user-select: none;
            cursor: pointer;
            direction: ltr;
        }

        :host::before {
            content: attr(progress);
            display: block;
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            color: var(--color-text-muted);
            font-size: 80%;
            pointer-events: none;
            direction: ltr;
        }

        nav-progressbar-cursor {
            display: none;
            position: absolute;
            width: 0;
            height: 0;
            top: 50%;
            pointer-events: none;
        }

        nav-progressbar-cursor::before {
            content: attr(chapter);
            display: none;
            position: absolute;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            white-space: nowrap;
            background: rgba(15, 23, 42, 0.9);
            color: #f8fafc;
            padding: 4px 10px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 500;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.2);
            pointer-events: none;
            z-index: 10;
            direction: ltr;
            unicode-bidi: plaintext;
        }

        :host(:hover) nav-progressbar-cursor[chapter]::before,
        :host(:active) nav-progressbar-cursor[chapter]::before,
        nav-progressbar-cursor.dragging[chapter]::before {
            display: block;
        }

        nav-progressbar-cursor::after {
            content: "";
            position: relative;
            display: block;
            width: 21px;
            height: 21px;
            border-radius: 50%;
            border: 3px double var(--color-border);
            background: white;
            transform: translateY(-50%);
            box-sizing: border-box;
            right: -11px;
            left: -11px;
        }
    `;

    constructor() {
        super();
        this.progress = 0;
        this.isDragging = false;
        this.doc = null;
        this.chapters = {};
        this.chapterEntries = [];
        this.initComponent();
    }

    get isRight2Left() {
        return window._app && window._app.writingMode === 'vertical';
    }

    initComponent() {
        const host = this.attachShadow({ mode: 'open' });

        this.cursor = document.createElement('nav-progressbar-cursor');
        host.appendChild(this.cursor);

        const innerStyle = new CSSStyleSheet();
        innerStyle.replaceSync(NavProgressBar.DEFAULT_STYLE);
        host.adoptedStyleSheets = [innerStyle];

        // 監聽 ReadingOperation: 取得閱讀文件實體與章節清單
        document.body.addEventListener('ReadingOperation', e => {
            if (e.detail?.action === 'read' && e.detail.params?.[0]) {
                const doc = e.detail.params[0];
                this.doc = doc;
                this.chapters = (typeof doc.getChapters === 'function' ? doc.getChapters() : {}) || {};
                this.chapterEntries = Object.entries(this.chapters);
                this.progress = doc.progress || 0;
                this.cursor.style.display = 'block';
                this.updateCursorPosition(this.progress);
                this.render();
            } else if (e.detail?.action === 'reset') {
                this.doc = null;
                this.chapters = {};
                this.chapterEntries = [];
                this.progress = 0;
                this.cursor.style.display = 'none';
                this.cursor.removeAttribute('title');
                this.cursor.removeAttribute('chapter');
                this.render();
            }
        });

        // 監聽閱讀面板渲染進度更新（拖曳時不被外部覆蓋）
        document.body.addEventListener('ReadingPanelRenderOver', e => {
            if (this.isDragging) return;
            this.progress = e.detail && typeof e.detail.progress === 'number' ? e.detail.progress : 0;
            this.cursor.style.display = 'block';
            this.updateCursorPosition(this.progress);
            this.render();
        });

        // 拖曳 (Drag) 與 點擊 (Click) 事件處理 (使用 Pointer Events 支援滑鼠與觸控)
        this.addEventListener('pointerdown', (e) => {
            if (e.button !== undefined && e.button !== 0) return;
            this.isDragging = true;
            this.cursor.classList.add('dragging');
            try {
                this.setPointerCapture(e.pointerId);
            } catch (err) {
                // Ignore pointer capture error
            }
            this.handlePointerProgress(e, false);
        });

        this.addEventListener('pointermove', (e) => {
            if (!this.isDragging) return;
            this.handlePointerProgress(e, false);
        });

        const onPointerUp = (e) => {
            if (!this.isDragging) return;
            this.isDragging = false;
            this.cursor.classList.remove('dragging');
            try {
                if (this.hasPointerCapture(e.pointerId)) {
                    this.releasePointerCapture(e.pointerId);
                }
            } catch (err) {
                // Ignore
            }
            this.handlePointerProgress(e, true);
        };

        this.addEventListener('pointerup', onPointerUp);
        this.addEventListener('pointercancel', onPointerUp);
    }

    getProgressFromEvent(e) {
        const rect = this.getBoundingClientRect();
        if (rect.width <= 0) return 0;

        let x = e.clientX - rect.left;
        x = Math.max(0, Math.min(rect.width, x));

        const isRTL = this.isRight2Left;
        // 若為直排 / RTL (由右至左)，進度從右側開始計算；若為橫排 / LTR，從左側開始計算
        const progress = isRTL ? (rect.width - x) / rect.width : x / rect.width;
        return Math.max(0, Math.min(1, progress));
    }

    handlePointerProgress(e, isCommit = false) {
        const progress = this.getProgressFromEvent(e);
        this.progress = progress;
        this.cursor.style.display = 'block';
        this.updateCursorPosition(progress);
        this.render();
        this.dispatchProgress(progress, isCommit);
    }

    getChapterTitle(prog) {
        if (this.doc && typeof this.doc.getCurrentChapter === 'function') {
            const ch = this.doc.getCurrentChapter(prog);
            if (ch && ch.title) return ch.title;
        }
        if (this.chapterEntries && this.chapterEntries.length > 0) {
            let currentTitle = this.chapterEntries[0][0];
            for (let i = 0; i < this.chapterEntries.length; i++) {
                const [title, chapterProg] = this.chapterEntries[i];
                if (chapterProg <= prog) {
                    currentTitle = title;
                } else {
                    break;
                }
            }
            return currentTitle;
        }
        return '';
    }

    updateCursorPosition(prog) {
        const pct = (prog * 100.0).toFixed(3) + '%';
        // 移動 cursor 位置 (依據 LTR / RTL 方向設置)
        if (this.cursor) {
            if (this.isRight2Left) {
                this.cursor.style.left = '';
                this.cursor.style.right = pct;
            } else {
                this.cursor.style.right = '';
                this.cursor.style.left = pct;
            }

            const chapterTitle = this.getChapterTitle(prog);
            if (chapterTitle) {
                this.cursor.title = chapterTitle;
                this.cursor.setAttribute('chapter', chapterTitle);
            } else {
                this.cursor.removeAttribute('title');
                this.cursor.removeAttribute('chapter');
            }
        }
    }

    dispatchProgress(progress, isCommit = false) {
        // 觸發 ReadingOperation 事件通知 ReadingPanel 更新進度
        this.fireEvent('ReadingOperation', {
            action: 'setProgress',
            params: [progress]
        }, true);

        // 觸發自定義 DOM 事件
        this.fireEvent('input', { progress, isCommit }, true);

        if (isCommit) {
            this.fireEvent('change', { progress }, true);
        }
    }

    render() {
        const prog = Math.max(0, Math.min(1, this.progress || 0));
        const pct = (prog * 100.0).toFixed(3) + '%';
        this.setAttribute('progress', pct);

        const isRTL = this.isRight2Left;
        const direction = isRTL ? 'to left' : 'to right';

        this.style.background = `linear-gradient(${direction}, var(--color-primary, #667eea) 0%, var(--color-primary, #667eea) ${pct}, var(--color-border, #e2e8f0) ${pct}, var(--color-border, #e2e8f0) 100%)`;
        this.updateCursorPosition(prog);
    }
}

if (typeof window !== 'undefined') {
    window.NavProgressBar = NavProgressBar;
    if (typeof customElements !== 'undefined' && !customElements.get('nav-progressbar')) {
        customElements.define('nav-progressbar', NavProgressBar);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { NavProgressBar };
}