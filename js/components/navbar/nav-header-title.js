class NavHeaderTitle extends Component {
    constructor() {
        super();
        this.currentTitle = '';
        this.initComponent();
    }

    initComponent() {
        this.classList.add('document-title-header');

        // 點擊標題時若有 action 則觸發 ActionPerformed (預設開啟檔案對話框)
        this.addEventListener('click', () => {
            const action = this.getAttribute('action') || 'open-explorer-dialog';
            this.fireEvent('ActionPerformed', { action }, Component.FLAG_EVENT_POPUP | Component.FLAG_EVENT_SYNC);
        });

        // 監聽 ReadingOperation: 讀取作品時顯示作品標題，重設時清空
        document.body.addEventListener('ReadingOperation', (e) => {
            if (e.detail?.action === 'read' && e.detail.params?.[0]) {
                const doc = e.detail.params[0];
                this.currentTitle = doc.title || '';
                this.render();
            } else if (e.detail?.action === 'reset') {
                this.currentTitle = '';
                this.render();
            }
        });

        // 監聽 ActionPerformed: 關閉作品時清除標題
        document.body.addEventListener('ActionPerformed', (e) => {
            if (e.detail?.action === 'close-reading-file') {
                this.currentTitle = '';
                this.render();
            }
        });

        // 監聽語言變更時更新預設提示文字
        document.body.addEventListener('LanguageChanged', () => {
            if (!this.currentTitle) {
                this.render();
            }
        });

        this.render();
    }

    render() {
        if (this.currentTitle) {
            this.textContent = this.currentTitle;
            this.title = this.currentTitle;
        } else {
            const defaultText = (window._app?.i18n?.t ? window._app.i18n.t('openFile') : null) || '開啟檔案';
            this.textContent = defaultText;
            this.title = defaultText;
        }
    }
}

if (typeof window !== 'undefined') {
    window.NavHeaderTitle = NavHeaderTitle;
    if (typeof customElements !== 'undefined' && !customElements.get('nav-header-title')) {
        customElements.define('nav-header-title', NavHeaderTitle);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { NavHeaderTitle };
}
