class DialogHeader extends Component {
    constructor() {
        super();
        this.initComponent();
    }

    initComponent() {
        this.classList.add('dialog-header');
        
        const closeBtn = document.createElement('BUTTON');
        closeBtn.className = 'btn-close';
        closeBtn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>';
        this.prepend(closeBtn);
        closeBtn.addEventListener('click', () => {
            const dialog = this.closest('dialog');
            if (dialog && typeof dialog.close === 'function') {
                dialog.close();
            }
        });
    }
}

window.DialogHeader = DialogHeader;
customElements.define('dialog-header', DialogHeader);
