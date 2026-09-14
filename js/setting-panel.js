class SettingPanel extends HTMLElement {
    constructor() {
        super();
        this.initComponent();
    }

}

window.SettingPanel = SettingPanel;
customElements.define('setting-panel', SettingPanel);