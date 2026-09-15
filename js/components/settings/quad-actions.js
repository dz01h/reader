class QuadActions extends HTMLElement {
    constructor() {
        super();
        this.initComponent();
    }

    initComponent() {
        this.className = 'setting-fieldset setting-group-row';
        const l = document.createElement('legend');
        l.setAttribute('data-i18n', 'settingQuadrants');
        this.append(l);
        const actions = JSON.stringify({
            "prev": "$actionPrev",
            "next": "$actionNext",
            "none": "$actionNone"
        });
        const toBuild = {quadTL: 'prev', quadTR: 'prev', quadBL: 'next', quadBR: 'next'};
        for(let p in toBuild) {
            const selector = new ListSelector(actions);
            selector.setAttribute('field', p);
            selector.setAttribute('data-i18n', p);
            selector.value = toBuild[p];
            selector.className = 'setting-group half';
            this.append(selector);
        }
    }
}

window.QuadCommends = QuadActions;
customElements.define('quad-actions', QuadActions);

