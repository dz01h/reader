class QuadActions extends HTMLElement {
    constructor() {
        super();
        this.initComponent();
    }

    initComponent() {
        const f = document.createElement('fieldset');
        f.className = 'setting-fieldset setting-group-row';
        this.appendChild(f);
        
        const l = document.createElement('legend');
        l.setAttribute('data-i18n', 'settingQuadrants');
        f.append(l);
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
            f.append(selector);
        }
    }
}

window.QuadCommends = QuadActions;
customElements.define('quad-actions', QuadActions);

