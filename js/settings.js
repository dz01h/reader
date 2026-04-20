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
        this.marginTopInput = document.getElementById('setting-margin-top');
        this.marginTopDisplay = document.getElementById('setting-margin-top-display');
        this.marginBottomInput = document.getElementById('setting-margin-bottom');
        this.marginBottomDisplay = document.getElementById('setting-margin-bottom-display');
        this.marginLeftInput = document.getElementById('setting-margin-left');
        this.marginLeftDisplay = document.getElementById('setting-margin-left-display');
        this.marginRightInput = document.getElementById('setting-margin-right');
        this.marginRightDisplay = document.getElementById('setting-margin-right-display');
        
        this.quadTLSelect = document.getElementById('setting-quad-tl');
        this.quadTRSelect = document.getElementById('setting-quad-tr');
        this.quadBLSelect = document.getElementById('setting-quad-bl');
        this.quadBRSelect = document.getElementById('setting-quad-br');
        this.googleClientIdInput = document.getElementById('setting-google-client-id');
        this.langSelect = document.getElementById('setting-lang');
        
        this.btnSyncQr = document.getElementById('btn-sync-qr');
        this.qrContainer = document.getElementById('qr-container');
        this.qrCodeEl = document.getElementById('qr-code');
    }

    syncUI() {
        this.themeSelect.value = document.documentElement.getAttribute('data-theme') || 'light';
        this.directionSelect.value = this.app.currentWritingMode;
        this.fontFamilySelect.value = this.app.currentFontFamily;
        this.fontSizeInput.value = this.app.currentFontSize;
        this.fontSizeDisplay.textContent = `${this.app.currentFontSize}px`;
        this.lineHeightInput.value = this.app.currentLineHeight;
        this.lineHeightDisplay.textContent = this.app.currentLineHeight;
        if (this.app.margins) {
            if (this.marginTopInput) {
                this.marginTopInput.value = this.app.margins.top;
                this.marginTopDisplay.textContent = this.app.margins.top;
            }
            if (this.marginBottomInput) {
                this.marginBottomInput.value = this.app.margins.bottom;
                this.marginBottomDisplay.textContent = this.app.margins.bottom;
            }
            if (this.marginLeftInput) {
                this.marginLeftInput.value = this.app.margins.left;
                this.marginLeftDisplay.textContent = this.app.margins.left;
            }
            if (this.marginRightInput) {
                this.marginRightInput.value = this.app.margins.right;
                this.marginRightDisplay.textContent = this.app.margins.right;
            }
        }
        
        this.quadTLSelect.value = this.app.quadTL;
        this.quadTRSelect.value = this.app.quadTR;
        this.quadBLSelect.value = this.app.quadBL;
        this.quadBRSelect.value = this.app.quadBR;
        
        this.googleClientIdInput.value = this.app.currentGoogleClientId || '';
        if (this.app.i18n && this.langSelect) {
            this.langSelect.value = this.app.i18n.lang;
        }
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

        if (this.marginTopInput) {
            this.marginTopInput.addEventListener('input', (e) => {
                const val = parseInt(e.target.value, 10);
                this.marginTopDisplay.textContent = val;
                this.app.setMargins({ top: val });
            });
        }
        if (this.marginBottomInput) {
            this.marginBottomInput.addEventListener('input', (e) => {
                const val = parseInt(e.target.value, 10);
                this.marginBottomDisplay.textContent = val;
                this.app.setMargins({ bottom: val });
            });
        }
        if (this.marginLeftInput) {
            this.marginLeftInput.addEventListener('input', (e) => {
                const val = parseInt(e.target.value, 10);
                this.marginLeftDisplay.textContent = val;
                this.app.setMargins({ left: val });
            });
        }
        if (this.marginRightInput) {
            this.marginRightInput.addEventListener('input', (e) => {
                const val = parseInt(e.target.value, 10);
                this.marginRightDisplay.textContent = val;
                this.app.setMargins({ right: val });
            });
        }

        this.quadTLSelect.addEventListener('change', (e) => this.app.setQuad('TL', e.target.value));
        this.quadTRSelect.addEventListener('change', (e) => this.app.setQuad('TR', e.target.value));
        this.quadBLSelect.addEventListener('change', (e) => this.app.setQuad('BL', e.target.value));
        this.quadBRSelect.addEventListener('change', (e) => this.app.setQuad('BR', e.target.value));
        
        this.googleClientIdInput.addEventListener('change', (e) => this.app.setGoogleClientId(e.target.value.trim()));
        
        if (this.langSelect) {
            this.langSelect.addEventListener('change', (e) => this.app.setLanguage(e.target.value));
        }

        if (this.btnSyncQr) {
            this.btnSyncQr.addEventListener('click', (e) => this.generateSyncQR(e));
        }

        // Transparency during slider interaction
        const startInteracting = e => {
            if(!e.target.matches('input[type="range"]')) return;
            this.dialog.classList.add('interacting');
            doInteracting(e);
        };
        let interactingTimer = null;
        const doInteracting = e => {
            if(!e.target.matches('input[type="range"]')) return;
            if(interactingTimer) clearTimeout(interactingTimer);
            interactingTimer = setTimeout(() => {
                this.dialog.classList.remove('interacting');
            }, 3000);
        }
        const stopInteracting = () => this.dialog.classList.remove('interacting');

        this.dialog.addEventListener('mousedown', startInteracting);
        this.dialog.addEventListener('touchstart', startInteracting, { passive: true });
        this.dialog.addEventListener('mousemove', doInteracting);
        this.dialog.addEventListener('touchmove', doInteracting, { passive: true });
        window.addEventListener('mouseup', stopInteracting);
        window.addEventListener('touchend', stopInteracting);
    }

    generateSyncQR(e) {
        e.preventDefault();
        
        if (this.qrContainer.classList.contains('hidden')) {
            // Check if user has entered anything useful
            if (!this.app.currentGoogleClientId) {
                this.app.showToast(this.app.i18n ? this.app.i18n.t('errorNoClientId') || '請先輸入 Client ID 再產生同步碼' : '請先輸入 Client ID');
                return;
            }

            this.qrContainer.classList.remove('hidden');
            this.qrCodeEl.innerHTML = '';
            
            // Serialize settings
            const state = {
                clientId: this.app.currentGoogleClientId,
                lang: this.app.i18n ? this.app.i18n.lang : 'en',
                theme: document.documentElement.getAttribute('data-theme'),
                fontSize: this.app.currentFontSize,
                lineHeight: this.app.currentLineHeight,
                margins: this.app.margins
            };
            
            // Encode
            const payload = btoa(JSON.stringify(state));
            
            // Construct sync URL using github pages base path (window.location.origin + pathname)
            const baseUrl = window.location.origin + window.location.pathname;
            const syncUrl = `${baseUrl}?sync=${payload}`;
            
            new QRCode(this.qrCodeEl, {
                text: syncUrl,
                width: 200,
                height: 200,
                colorDark : "#000000",
                colorLight : "#ffffff",
                correctLevel : QRCode.CorrectLevel.L
            });
        } else {
            this.qrContainer.classList.add('hidden');
        }
    }
}

window.ZenSettings = ZenSettings;
