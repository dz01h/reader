class ExplorerPanel extends Component {
    constructor() {
        super();
        this.initComponent();
    }

    connectedCallback() {
        this.bindParentDialog();
        this.loadData();
    }

    initComponent() {
        // 1. Dialog Header
        const header = document.createElement('div');
        header.className = 'dialog-header';
        header.innerHTML = `
            <button id="btn-close-explorer" class="btn-close" data-i18n="title:close" title="關閉">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
            </button>
            <h2 data-i18n="libraryTitle">書籍庫</h2>
            <button id="btn-upload-file" class="btn-close" data-i18n="title:openFile" title="開啟本機檔案" style="color: var(--color-primary, #667eea);">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
            </button>
        `;
        this.prepend(header);

        // Header close button
        header.querySelector('#btn-close-explorer').addEventListener('click', () => {
            const dialog = this.parentElement || this.closest?.('dialog');
            if (dialog && typeof dialog.close === 'function') {
                dialog.close();
            }
        });

        // Header local file upload button
        header.querySelector('#btn-upload-file').addEventListener('click', () => {
            const fileInput = document.getElementById('file-input');
            if (fileInput) {
                fileInput.click();
            }
        });

        // 2. File Panel embedding
        this.filePanel = this.querySelector('file-panel');
        if (!this.filePanel) {
            this.filePanel = document.createElement('file-panel');
            this.appendChild(this.filePanel);
        }

        this.bindParentDialog();
    }

    bindParentDialog() {
        const dialog = this.parentElement || this.closest?.('dialog');
        if (!dialog || dialog._explorerPanelBound) return;
        dialog._explorerPanelBound = true;

        dialog.addEventListener('initComponent', e => { (e.newState === 'open') && this.loadData(); });
        dialog.addEventListener('open', () => this.loadData());

        // Observe open attribute on dialog
        const observer = new MutationObserver(mutations => {
            for (const m of mutations) {
                if (m.type === 'attributes' && m.attributeName === 'open' && dialog.open) {
                    this.loadData();
                }
            }
        });
        observer.observe(dialog, { attributes: true, attributeFilter: ['open'] });

        // Click outside (backdrop) to close dialog
        dialog.addEventListener('click', e => {
            if (e.target === dialog) {
                const rect = dialog.getBoundingClientRect();
                const isOutside = (
                    e.clientX < rect.left ||
                    e.clientX > rect.right ||
                    e.clientY < rect.top ||
                    e.clientY > rect.bottom
                );
                if (isOutside && typeof dialog.close === 'function') {
                    dialog.close();
                }
            }
        });
    }

    loadData() {
        if (this.filePanel && typeof this.filePanel.refresh === 'function') {
            this.filePanel.refresh();
        }
    }
}

if (typeof window !== 'undefined') {
    window.ExplorerPanel = ExplorerPanel;
    customElements.define('explorer-panel', ExplorerPanel);
}
