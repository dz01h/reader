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
        this.langSelect = document.getElementById('setting-lang');
        
        this.btnSyncQr = document.getElementById('btn-sync-qr');
        this.btnGasAuth = document.getElementById('btn-gas-auth');
        this.syncCooldownSelect = document.getElementById('setting-sync-cooldown');
        this.qrContainer = document.getElementById('qr-container');
        this.qrCodeEl = document.getElementById('qr-code');

        this.ttsEngineSelect = document.getElementById('setting-tts-engine');
        this.ttsVoiceSelect = document.getElementById('setting-tts-voice');
        this.ttsSpeedSlider = document.getElementById('setting-tts-speed-slider');
        this.ttsSpeedDisplay = document.getElementById('setting-tts-speed-display');

        this.btnShowDebug = document.getElementById('btn-show-debug');
        this.debugDialog = document.getElementById('debug-log-dialog');
        this.debugContent = document.getElementById('debug-log-content');
        this.btnCloseDebug = document.getElementById('btn-close-debug-log');
        this.btnClearDebug = document.getElementById('btn-clear-debug-log');
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
        
        if (this.app.i18n && this.langSelect) {
            this.langSelect.value = this.app.i18n.lang;
        }

        if (this.syncCooldownSelect) {
            this.syncCooldownSelect.value = this.app.syncCooldown;
        }

        if (this.ttsEngineSelect) {
            this.ttsEngineSelect.value = this.app.ttsEngine || 'piper';
        }
        this.updateVoiceDropdown();
        if (this.ttsSpeedSlider) {
            this.ttsSpeedSlider.value = this.app.ttsSpeed || 1.0;
            this.ttsSpeedDisplay.textContent = (this.app.ttsSpeed || 1.0).toFixed(1);
        }
    }

    updateVoiceDropdown() {
        if (!this.ttsVoiceSelect) return;
        this.ttsVoiceSelect.innerHTML = '';

        const engine = this.app.ttsEngine || 'piper';
        if (engine === 'piper') {
            const piperVoices = [
                { value: 'zh_CN-huayan-medium', name: '胡燕 (溫柔女聲)' },
                { value: 'zh_CN-pmsurvey-medium', name: '專業女聲' },
                { value: 'zh_CN-yunjie-medium', name: '雲捷 (清亮男聲)' },
                { value: 'zh_CN-yunye-medium', name: '雲野 (沉穩男聲)' }
            ];
            piperVoices.forEach(v => {
                const opt = document.createElement('option');
                opt.value = v.value;
                opt.textContent = v.name;
                this.ttsVoiceSelect.appendChild(opt);
            });
            this.ttsVoiceSelect.value = this.app.ttsVoice || 'zh_CN-huayan-medium';
        } else if (engine === 'webspeech') {
            const voices = window.speechSynthesis.getVoices();
            if (voices.length === 0) {
                const opt = document.createElement('option');
                opt.value = '';
                opt.textContent = '載入系統語音中...';
                this.ttsVoiceSelect.appendChild(opt);
                
                window.speechSynthesis.addEventListener('voiceschanged', () => {
                    this.updateVoiceDropdown();
                }, { once: true });
                return;
            }

            voices.forEach(v => {
                const opt = document.createElement('option');
                opt.value = v.voiceURI;
                opt.textContent = `${v.name} (${v.lang})`;
                this.ttsVoiceSelect.appendChild(opt);
            });

            const voiceExists = voices.some(v => v.voiceURI === this.app.ttsVoice);
            if (voiceExists) {
                this.ttsVoiceSelect.value = this.app.ttsVoice;
            } else {
                const zhVoice = voices.find(v => v.lang.includes('zh') || v.lang.includes('ZH'));
                if (zhVoice) {
                    this.ttsVoiceSelect.value = zhVoice.voiceURI;
                    this.app.ttsVoice = zhVoice.voiceURI;
                    this.app.saveState({ ttsVoice: zhVoice.voiceURI });
                } else if (voices.length > 0) {
                    this.ttsVoiceSelect.value = voices[0].voiceURI;
                    this.app.ttsVoice = voices[0].voiceURI;
                    this.app.saveState({ ttsVoice: voices[0].voiceURI });
                }
            }
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
        
        
        if (this.langSelect) {
            this.langSelect.addEventListener('change', (e) => this.app.setLanguage(e.target.value));
        }

        if (this.syncCooldownSelect) {
            this.syncCooldownSelect.addEventListener('change', (e) => this.app.setSyncCooldown(e.target.value));
        }

        if (this.ttsEngineSelect) {
            this.ttsEngineSelect.addEventListener('change', (e) => {
                this.app.setTTSEngine(e.target.value);
                this.updateVoiceDropdown();
            });
        }
        if (this.ttsVoiceSelect) {
            this.ttsVoiceSelect.addEventListener('change', (e) => {
                this.app.setTTSVoice(e.target.value);
            });
        }
        if (this.ttsSpeedSlider) {
            this.ttsSpeedSlider.addEventListener('input', (e) => {
                const speed = parseFloat(e.target.value);
                this.ttsSpeedDisplay.textContent = speed.toFixed(1);
                this.app.setTTSSpeed(speed);
            });
        }

        if (this.btnGasAuth) {
            this.btnGasAuth.addEventListener('click', () => {
                window.open('https://myaccount.google.com/connections', '_blank');
            });
        }

        if (this.btnSyncQr) {
            this.btnSyncQr.addEventListener('click', (e) => this.generateSyncQR(e));
        }

        if (this.btnShowDebug) {
            this.btnShowDebug.addEventListener('click', () => {
                const logs = JSON.parse(localStorage.getItem('zen_tts_debug_log') || '[]');
                this.debugContent.textContent = logs.join('\n');
                this.debugDialog.showModal();
            });
        }

        if (this.btnCloseDebug) {
            this.btnCloseDebug.addEventListener('click', () => this.debugDialog.close());
        }

        if (this.btnClearDebug) {
            this.btnClearDebug.addEventListener('click', () => {
                localStorage.removeItem('zen_tts_debug_log');
                this.debugContent.textContent = '';
                this.app.showToast('紀錄已清除');
            });
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
            this.qrContainer.classList.remove("hidden");
            this.qrCodeEl.innerHTML = "";
            const state = {
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
