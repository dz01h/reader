class ZenSettings {
    constructor(appInstance) {
        this.app = appInstance;
        this.initDOM();
        this.bindEvents();
    }

    initDOM() {
        this.dialog = document.getElementById('settings-dialog');
        this.btnOpen = document.getElementById('btn-open-settings');
        this.btnClose = document.getElementById('btn-close-settings');
        
        this.themeSelect = document.getElementById('setting-theme');
        this.directionSelect = document.getElementById('setting-direction');
        this.fontFamilySelect = document.getElementById('setting-font-family');
        this.fontSizeInput = document.getElementById('setting-font-size');
        this.fontSizeDisplay = document.getElementById('setting-font-size-display');
        this.lineHeightInput = document.getElementById('setting-line-height');
        this.lineHeightDisplay = document.getElementById('setting-line-height-display');
        
        this.quadTLSelect = document.getElementById('setting-quad-tl');
        this.quadTRSelect = document.getElementById('setting-quad-tr');
        this.quadBLSelect = document.getElementById('setting-quad-bl');
        this.quadBRSelect = document.getElementById('setting-quad-br');
    }

    syncUI() {
        this.themeSelect.value = document.documentElement.getAttribute('data-theme') || 'light';
        this.directionSelect.value = this.app.currentWritingMode;
        this.fontFamilySelect.value = this.app.currentFontFamily;
        this.fontSizeInput.value = this.app.currentFontSize;
        this.fontSizeDisplay.textContent = `${this.app.currentFontSize}px`;
        this.lineHeightInput.value = this.app.currentLineHeight;
        this.lineHeightDisplay.textContent = this.app.currentLineHeight;
        
        this.quadTLSelect.value = this.app.quadTL;
        this.quadTRSelect.value = this.app.quadTR;
        this.quadBLSelect.value = this.app.quadBL;
        this.quadBRSelect.value = this.app.quadBR;
    }

    bindEvents() {
        this.btnOpen.addEventListener('click', () => {
            this.syncUI();
            this.dialog.showModal();
        });

        this.btnClose.addEventListener('click', () => {
            this.dialog.close();
        });

        // Close when clicking outside of the dialog boundary
        this.dialog.addEventListener('click', (e) => {
            const rect = this.dialog.getBoundingClientRect();
            if (e.clientY < rect.top || e.clientY > rect.bottom || e.clientX < rect.left || e.clientX > rect.right) {
                this.dialog.close();
            }
        });

        this.themeSelect.addEventListener('change', (e) => {
            this.app.setTheme(e.target.value);
        });

        this.directionSelect.addEventListener('change', (e) => {
            this.app.setWritingMode(e.target.value);
        });

        this.fontSizeInput.addEventListener('input', (e) => {
            const size = parseInt(e.target.value, 10);
            this.fontSizeDisplay.textContent = `${size}px`;
            this.app.setFontSize(size);
        });

        this.fontFamilySelect.addEventListener('change', (e) => {
            this.app.setFontFamily(e.target.value);
        });

        this.lineHeightInput.addEventListener('input', (e) => {
            const ratio = parseFloat(e.target.value);
            this.lineHeightDisplay.textContent = ratio.toFixed(1);
            this.app.setLineHeight(ratio);
        });

        this.quadTLSelect.addEventListener('change', (e) => this.app.setQuad('TL', e.target.value));
        this.quadTRSelect.addEventListener('change', (e) => this.app.setQuad('TR', e.target.value));
        this.quadBLSelect.addEventListener('change', (e) => this.app.setQuad('BL', e.target.value));
        this.quadBRSelect.addEventListener('change', (e) => this.app.setQuad('BR', e.target.value));
    }
}

window.ZenSettings = ZenSettings;
