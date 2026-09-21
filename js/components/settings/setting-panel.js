class SettingPanel extends Component {
    constructor() {
        super();
        this.initComponent();
    }

    connectedCallback() {
        this.bindParentDialog();
        this.loadData();
    }

    initComponent() {
        this.bindParentDialog();
        this.addEventListener('settingUpdated', e => { this.syncValue(e); });

        // Margin Slider interactions for guideline overlay
        this.addEventListener('sliderstart', (e) => {
            const field = e.target.getAttribute?.('field');
            if (field && field.startsWith('margins')) {
                document.body.classList.add('settings-interacting');
                this.fireEvent('ReadingOperation', { action: 'render', params: [false, 0, window._app] }, true);
            }
        });
        this.addEventListener('sliderend', (e) => {
            document.body.classList.remove('settings-interacting');
            this.fireEvent('ReadingOperation', { action: 'render', params: [false, 0, window._app] }, true);
        });
    }

    bindParentDialog() {
        const dialog = this.parentElement || this.closest?.('dialog');
        if (!dialog || dialog._settingPanelBound) return;
        dialog._settingPanelBound = true;

        dialog.addEventListener('initComponent', e => { (e.newState === 'open') && this.loadData(); });
        dialog.addEventListener('open', () => this.loadData());

        // Observe open attribute for showModal / dialog open changes
        const observer = new MutationObserver(mutations => {
            for (const m of mutations) {
                if (m.type === 'attributes' && m.attributeName === 'open' && dialog.open) {
                    this.loadData();
                }
            }
        });
        observer.observe(dialog, { attributes: true, attributeFilter: ['open'] });

        // 點擊毛玻璃 (backdrop) 關閉 dialog
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
        if (!window._app) return;
        const components = this.querySelectorAll('[field]');
        for (let c of components) {
            const fieldPath = c.getAttribute('field');
            if (!fieldPath) continue;
            const parts = fieldPath.split('.');
            let val = window._app;
            for (let p of parts) {
                if (val != null) val = val[p];
                else { val = null; break; }
            }
            if (val != null) {
                c.value = val;
            }
        }
    }

    syncValue(e) {
        if (!window._app) return;
        const { field, value, isCommit } = e.detail;
        if (!field) return;

        const fieldLayer = field.split('.');
        const keyField = fieldLayer.pop();
        let target = window._app;
        for (let f of fieldLayer) {
            if (target[f] == null) target[f] = {};
            target = target[f];
        }
        target[keyField] = value;

        // Apply immediate UI visual changes for global document styles
        if (field === 'theme') {
            document.documentElement.setAttribute('data-theme', value);
        } else if (field === 'writingMode') {
            document.documentElement.setAttribute('data-writing-mode', value);
        } else if (field === 'lang') {
            document.documentElement.setAttribute('lang', value);
            if (window._app.i18n) window._app.i18n.setLanguage(value);
        }

        if (isCommit) {
            // Commit: update engine configuration and persist
            this.fireEvent('ReadingOperation', {
                action: 'updateConfig',
                params: [window._app]
            }, true);

            if (typeof window._app.saveState === 'function') {
                window._app.saveState();
            } else if (typeof window._app.saveConfig === 'function') {
                window._app.saveConfig();
            }
        } else {
            // Live preview while dragging
            this.fireEvent('ReadingOperation', {
                action: 'render',
                params: [false, 0, window._app]
            }, true);
        }
    }
}

window.SettingPanel = SettingPanel;
customElements.define('setting-panel', SettingPanel);
