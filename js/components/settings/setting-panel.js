class SettingPanel extends HTMLElement {
    constructor() {
        super();
        this.initComponent();
    }

    initComponent() {
        // 1. Header
        const header = document.createElement('div');
        header.className = 'dialog-header';
        header.innerHTML = `
            <button id="btn-close-settings" class="btn-close" data-i18n="title:close" title="關閉">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
            </button>
            <h2 data-i18n="settingsTitle">閱讀設定</h2>
            <div style="width: 24px;"></div>
        `;
        this.prepend(header);
        header.querySelector('.btn-close').addEventListener('click', e => { this.parentElement.close(); });

        this.parentElement.addEventListener('initComponent', e => { (e.newState === 'open') && this.loadData(); });
        this.addEventListener('settingUpdated', e => { this.syncValue(e); });
    }

    loadData() {
        if(!window._app) return;
        const components = this.querySelectorAll('[field]');
        for(let c of components) {
            c.value = window._app[c.getAttribute('field')] ?? null;
        }
    }

    syncValue(e) {
        if(!window._app) return;
        const fieldLayer = e.detail.field.split('.');
        const keyField = fieldLayer.pop();
        let target = window._app;
        for(let f in fieldLayer) target = target[f];
        target[keyField] = e.detail.value;
        document.body.dispatchEvent(new CustomEvent('ReadingOperation', {detail: { action: 'render' }}));
    }

}

window.SettingPanel = SettingPanel;
customElements.define('setting-panel', SettingPanel);
