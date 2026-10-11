class NavChapterSelector extends Component {
    static DEFAULT_STYLE = `
        :host {
            display: flex;
            flex-direction: column;
            position: absolute;
            bottom: 75px;
            left: 1rem;
            width: 300px;
            max-height: 50vh;
            background: var(--color-bg, #ffffff);
            border: 1px solid var(--color-border, #e2e8f0);
            border-radius: var(--radius-lg, 8px);
            box-shadow: var(--shadow-lg, 0 10px 15px -3px rgba(0, 0, 0, 0.1));
            z-index: 100;
            transition: opacity 0.2s ease, transform 0.2s ease;
            transform-origin: bottom left;
            box-sizing: border-box;
            direction: ltr;
        }

        :host(.hidden),
        :host([hidden]) {
            display: none !important;
            opacity: 0;
            transform: scale(0.95);
            pointer-events: none;
        }

        .toc-header {
            padding: 0.75rem 1rem;
            font-weight: 600;
            border-bottom: 1px solid var(--color-border, #e2e8f0);
            background: var(--color-surface, #f8fafc);
            border-radius: var(--radius-lg, 8px) var(--radius-lg, 8px) 0 0;
            color: var(--color-text, #1e293b);
            user-select: none;
        }

        .toc-list {
            overflow-y: auto;
            padding: 0.5rem 0;
            flex: 1;
            max-height: calc(50vh - 45px);
        }

        .toc-item {
            padding: 0.5rem 1rem;
            font-size: 0.9rem;
            cursor: pointer;
            color: var(--color-text, #1e293b);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            transition: background-color 0.15s ease;
            direction: ltr;
            unicode-bidi: plaintext;
        }

        .toc-item:hover {
            background: var(--color-surface, #f1f5f9);
        }

        .toc-item.active {
            background: rgba(102, 126, 234, 0.18);
            color: #4f46e5;
            font-weight: 600;
        }

        :host-context([data-theme="dark"]) .toc-item.active,
        [data-theme="dark"] .toc-item.active {
            background: rgba(129, 140, 248, 0.25);
            color: #a5b4fc;
        }

        .toc-item.empty {
            opacity: 0.5;
            cursor: default;
        }
    `;

    constructor() {
        super();
        this.chapters = {};
        this.currentChapter = null;
        this.initComponent();
    }

    initComponent() {
        const host = this.attachShadow({ mode: 'open' });

        this.headerEl = document.createElement('div');
        this.headerEl.className = 'toc-header';
        this.headerEl.setAttribute('data-i18n', 'toc');
        this.headerEl.textContent = (window._app?.i18n?.t ? window._app.i18n.t('toc') : null) || '目錄';

        this.listEl = document.createElement('div');
        this.listEl.className = 'toc-list';

        this.listEl.addEventListener('click', (e) => {
            const item = e.target?.closest?.('.toc-item');
            if (!item || item.classList.contains('empty')) return;

            const progress = parseFloat(item.getAttribute('data-progress'));
            if (!isNaN(progress)) {
                this.fireEvent('ReadingOperation', {
                    action: 'setProgress',
                    params: [progress]
                }, Component.FLAG_EVENT_POPUP | Component.FLAG_EVENT_SYNC);
                this.close();
            }
        });

        host.appendChild(this.headerEl);
        host.appendChild(this.listEl);

        const innerStyle = new CSSStyleSheet();
        innerStyle.replaceSync(NavChapterSelector.DEFAULT_STYLE);
        host.adoptedStyleSheets = [innerStyle];

        // 預設為隱藏狀態
        this.close();

        // 監聽 ReadingPanelRenderOver: 取得閱讀進度、章節清單與當前章節 (doc指標由 ReadingPanel 持有)
        document.body.addEventListener('ReadingPanelRenderOver', e => {
            const data = e.detail;
            if (!data) return;

            if (data.chapters !== undefined) {
                const newKeys = Object.keys(data.chapters || {}).join('|');
                const oldKeys = Object.keys(this.chapters || {}).join('|');
                if (newKeys !== oldKeys) {
                    this.chapters = data.chapters || {};
                    this.renderList();
                }
            }

            if (data.currentChapter !== undefined) {
                this.currentChapter = data.currentChapter;
                if (this.isOpen) {
                    this.highlightCurrentChapter();
                }
            }
        });

        // 監聽 reset 操作以清空章節清單
        document.body.addEventListener('ReadingOperation', e => {
            if (e.detail?.action === 'reset') {
                this.currentChapter = null;
                this.chapters = {};
                this.renderList();
                this.close();
            }
        });

        this.renderList();
    }

    get isOpen() {
        return !this.classList.contains('hidden') && !this.hasAttribute('hidden');
    }

    open() {
        this.classList.remove('hidden');
        this.removeAttribute('hidden');
        this.highlightCurrentChapter();
    }

    highlightCurrentChapter() {
        if (!this.listEl) return;

        // 清除先前的高亮標記
        this.listEl.querySelectorAll('.toc-item.active').forEach(el => el.classList.remove('active'));

        if (!this.currentChapter || !this.currentChapter.title) return;

        const items = this.listEl.querySelectorAll('.toc-item:not(.empty)');
        let matchedEl = null;

        for (const item of items) {
            if (item.textContent.trim() === this.currentChapter.title.trim()) {
                matchedEl = item;
                break;
            }
        }

        if (matchedEl) {
            matchedEl.classList.add('active');
            requestAnimationFrame(() => {
                matchedEl.scrollIntoView({ block: 'center', behavior: 'auto' });
            });
        }
    }

    close() {
        this.classList.add('hidden');
        this.setAttribute('hidden', '');
    }

    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    renderList() {
        if (!this.listEl) return;
        this.listEl.innerHTML = '';

        const entries = Object.entries(this.chapters || {});
        if (entries.length === 0) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'toc-item empty';
            emptyEl.textContent = '無章節資訊';
            this.listEl.appendChild(emptyEl);
            return;
        }

        for (const [title, progress] of entries) {
            const itemEl = document.createElement('div');
            itemEl.className = 'toc-item';
            itemEl.textContent = title;
            itemEl.setAttribute('data-progress', String(progress));
            this.listEl.appendChild(itemEl);
        }
    }
}

if (typeof window !== 'undefined') {
    window.NavChapterSelector = NavChapterSelector;
    if (typeof customElements !== 'undefined' && !customElements.get('nav-chapter-selector')) {
        customElements.define('nav-chapter-selector', NavChapterSelector);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { NavChapterSelector };
}
