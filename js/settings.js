function throttleLayout(fn, delay = 100) {
    let lastCall = 0;
    let timeout = null;
    return function(...args) {
        const now = Date.now();
        if (now - lastCall < delay) {
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                lastCall = Date.now();
                fn.apply(this, args);
            }, delay - (now - lastCall));
        } else {
            lastCall = now;
            fn.apply(this, args);
        }
    };
}

class CustomSlider {
    constructor(element, onChange) {
        this.el = element;
        this.min = parseFloat(element.dataset.min);
        this.max = parseFloat(element.dataset.max);
        this.step = parseFloat(element.dataset.step);
        this.value = this.min;
        this.onChange = onChange;

        this.track = document.createElement('div');
        this.track.className = 'custom-slider-track';
        this.fill = document.createElement('div');
        this.fill.className = 'custom-slider-fill';
        this.thumb = document.createElement('div');
        this.thumb.className = 'custom-slider-thumb';

        this.track.appendChild(this.fill);
        this.track.appendChild(this.thumb);
        this.el.appendChild(this.track);

        this.isDragging = false;
        this.ticking = false;
        this.bindEvents();
    }

    setValue(val, trigger = false) {
        let steps = Math.round((val - this.min) / this.step);
        let snapped = this.min + steps * this.step;
        snapped = Math.max(this.min, Math.min(this.max, snapped));
        const decimals = (this.step.toString().split('.')[1] || '').length;
        snapped = parseFloat(snapped.toFixed(decimals));

        if (this.value !== snapped) {
            this.value = snapped;
            this.updateVisuals();
            if (trigger && this.onChange) this.onChange(this.value);
        }
    }

    updateVisuals() {
        const pct = ((this.value - this.min) / (this.max - this.min)) * 100;
        this.fill.style.width = `${pct}%`;
        this.thumb.style.left = `${pct}%`;
    }

    handleMove(clientX) {
        const rect = this.el.getBoundingClientRect();
        let pct = (clientX - rect.left) / rect.width;
        pct = Math.max(0, Math.min(1, pct));
        const rawVal = this.min + pct * (this.max - this.min);
        this.setValue(rawVal, true);
    }

    bindEvents() {
        const start = (e) => {
            this.isDragging = true;
            this.el.classList.add('active');
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            this.handleMove(clientX);
            this.el.dispatchEvent(new CustomEvent('sliderstart', { bubbles: true }));
        };
        const move = (e) => {
            if (!this.isDragging) return;
            if (e.cancelable) e.preventDefault();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            if (!this.ticking) {
                window.requestAnimationFrame(() => {
                    this.handleMove(clientX);
                    this.ticking = false;
                });
                this.ticking = true;
            }
        };
        const end = () => {
            if (this.isDragging) {
                this.isDragging = false;
                this.el.classList.remove('active');
                this.el.dispatchEvent(new CustomEvent('sliderend', { bubbles: true }));
            }
        };

        this.el.addEventListener('mousedown', start);
        this.el.addEventListener('touchstart', start, { passive: false });
        window.addEventListener('mousemove', move, { passive: false });
        window.addEventListener('touchmove', move, { passive: false });
        window.addEventListener('mouseup', end);
        window.addEventListener('touchend', end);
    }
}

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
        this.btnLoadLocalFonts = document.getElementById('btn-load-local-fonts');
        
        if (this.btnLoadLocalFonts && 'queryLocalFonts' in window) {
            this.btnLoadLocalFonts.style.display = 'block';
            this.btnLoadLocalFonts.addEventListener('click', () => this.loadLocalFonts());
            
            // Auto-load if permission is already granted
            if (navigator.permissions && navigator.permissions.query) {
                navigator.permissions.query({ name: 'local-fonts' }).then(result => {
                    if (result.state === 'granted') {
                        this.loadLocalFonts(true);
                    }
                }).catch(err => console.log('local-fonts permission query failed:', err));
            }
        }
        
        this.fontSizeDisplay = document.getElementById('setting-font-size-display');
        this.fontSizeSlider = new CustomSlider(document.getElementById('setting-font-size'), throttleLayout((val) => {
            this.fontSizeDisplay.textContent = `${val}px`;
            this.app.setFontSize(val);
        }));

        this.lineHeightDisplay = document.getElementById('setting-line-height-display');
        this.lineHeightSlider = new CustomSlider(document.getElementById('setting-line-height'), throttleLayout((val) => {
            this.lineHeightDisplay.textContent = val.toFixed(1);
            this.app.setLineHeight(val);
        }));

        this.marginTopDisplay = document.getElementById('setting-margin-top-display');
        this.marginTopSlider = new CustomSlider(document.getElementById('setting-margin-top'), throttleLayout((val) => {
            this.marginTopDisplay.textContent = val;
            this.app.setMargins({ top: val });
        }));

        this.marginBottomDisplay = document.getElementById('setting-margin-bottom-display');
        this.marginBottomSlider = new CustomSlider(document.getElementById('setting-margin-bottom'), throttleLayout((val) => {
            this.marginBottomDisplay.textContent = val;
            this.app.setMargins({ bottom: val });
        }));

        this.marginLeftDisplay = document.getElementById('setting-margin-left-display');
        this.marginLeftSlider = new CustomSlider(document.getElementById('setting-margin-left'), throttleLayout((val) => {
            this.marginLeftDisplay.textContent = val;
            this.app.setMargins({ left: val });
        }));

        this.marginRightDisplay = document.getElementById('setting-margin-right-display');
        this.marginRightSlider = new CustomSlider(document.getElementById('setting-margin-right'), throttleLayout((val) => {
            this.marginRightDisplay.textContent = val;
            this.app.setMargins({ right: val });
        }));

        this.quadTLSelect = document.getElementById('setting-quad-tl');
        this.quadTRSelect = document.getElementById('setting-quad-tr');
        this.quadBLSelect = document.getElementById('setting-quad-bl');
        this.quadBRSelect = document.getElementById('setting-quad-br');
        this.langSelect = document.getElementById('setting-lang');

        this.btnSyncQr = document.getElementById('btn-sync-qr');
        this.btnGoogleLogin = document.getElementById('btn-google-login');
        this.btnOpenReadingLog = document.getElementById('btn-open-reading-log');
        this.syncCooldownSelect = document.getElementById('setting-sync-cooldown');
        this.qrContainer = document.getElementById('qr-container');
        this.qrCodeEl = document.getElementById('qr-code');

        this.ttsModelSelect = document.getElementById('setting-tts-model');
        this.ttsSpeedDisplay = document.getElementById('setting-tts-speed-display');
        this.ttsSpeedSlider = new CustomSlider(document.getElementById('setting-tts-speed-slider'), (val) => {
            this.ttsSpeedDisplay.textContent = val.toFixed(1);
            this.app.setTTSSpeed(val);
        });

        this.btnShowErrorLog = document.getElementById('btn-show-error-log');
        this.btnClearCache = document.getElementById('btn-clear-cache');
        this.errorLogDialog = document.getElementById('error-log-dialog');
        this.errorLogContent = document.getElementById('error-log-content');
        this.btnCloseErrorLog = document.getElementById('btn-close-error-log');
        this.btnClearErrorLog = document.getElementById('btn-clear-error-log');
    }

    syncUI() {
        this.themeSelect.value = document.documentElement.getAttribute('data-theme') || 'light';
        this.directionSelect.value = this.app.currentWritingMode;
        this.fontFamilySelect.value = this.app.currentFontFamily;
        if (this.fontSizeSlider) this.fontSizeSlider.setValue(this.app.currentFontSize);
        this.fontSizeDisplay.textContent = `${this.app.currentFontSize}px`;
        if (this.lineHeightSlider) this.lineHeightSlider.setValue(this.app.currentLineHeight);
        this.lineHeightDisplay.textContent = this.app.currentLineHeight;
        
        if (this.app.margins) {
            if (this.marginTopSlider) {
                this.marginTopSlider.setValue(this.app.margins.top);
                this.marginTopDisplay.textContent = this.app.margins.top;
            }
            if (this.marginBottomSlider) {
                this.marginBottomSlider.setValue(this.app.margins.bottom);
                this.marginBottomDisplay.textContent = this.app.margins.bottom;
            }
            if (this.marginLeftSlider) {
                this.marginLeftSlider.setValue(this.app.margins.left);
                this.marginLeftDisplay.textContent = this.app.margins.left;
            }
            if (this.marginRightSlider) {
                this.marginRightSlider.setValue(this.app.margins.right);
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

        this.updateModelDropdown();
        if (this.ttsSpeedSlider) {
            this.ttsSpeedSlider.setValue(this.app.ttsSpeed || 1.0);
            this.ttsSpeedDisplay.textContent = (this.app.ttsSpeed || 1.0).toFixed(1);
        }
        
        if (this.app.updateGoogleUIState) {
            this.app.updateGoogleUIState();
        }
    }

    updateModelDropdown() {
        if (!this.ttsModelSelect) return;

        // Save current selection to restore it after rebuilding
        const currentSelection = this.ttsModelSelect.value || `${this.app.ttsEngine || 'piper'}:${this.app.ttsVoice || 'zh_CN-huayan-medium'}`;

        this.ttsModelSelect.innerHTML = '';


        // 4. Matcha Group (獨立的高速 TTS 引擎)
        const matchaGroup = document.createElement('optgroup');
        matchaGroup.label = 'Matcha TTS (獨立引擎)';
        const matchaVoices = [
            { value: 'matcha:matcha-icefall-zh-baker:0', name: 'Matcha Baker (高速純中文)' },
            { value: 'matcha:matcha-icefall-zh-en:0', name: 'Matcha 中英雙語 (高速)' }
        ];
        matchaVoices.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v.value;
            opt.textContent = v.name;
            matchaGroup.appendChild(opt);
        });
        this.ttsModelSelect.appendChild(matchaGroup);
        const webSpeechGroup = document.createElement('optgroup');
        webSpeechGroup.label = 'Web Speech API (系統原生/極度省電)';

        const voices = window.speechSynthesis.getVoices();
        if (voices.length === 0) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = '載入系統語音中...';
            webSpeechGroup.appendChild(opt);
            this.ttsModelSelect.appendChild(webSpeechGroup);

            window.speechSynthesis.addEventListener('voiceschanged', () => {
                this.updateModelDropdown();
            }, { once: true });
        } else {
            voices.forEach(v => {
                const opt = document.createElement('option');
                opt.value = `webspeech:${v.voiceURI}`;
                opt.textContent = `${v.name} (${v.lang})`;
                webSpeechGroup.appendChild(opt);
            });
            this.ttsModelSelect.appendChild(webSpeechGroup);
        }

        // Restore selection or find nearest fallback
        const options = Array.from(this.ttsModelSelect.options);
        const hasOption = options.some(o => o.value === currentSelection);
        if (hasOption) {
            this.ttsModelSelect.value = currentSelection;
        } else {
            this.ttsModelSelect.value = 'piper:zh_CN-huayan-medium';
            const fbVal = this.ttsModelSelect.value;
            const fbIdx = fbVal.indexOf(':');
            this.app.setTTSModel(fbVal.substring(0, fbIdx), fbVal.substring(fbIdx + 1));
        }
    }

    bindEvents() {
        this.btnOpen.addEventListener('click', () => {
            this.syncUI();
            if (!history.state || history.state.settings !== true) {
                history.pushState({ ...history.state, settings: true }, '', '#settings');
            }
            this.dialog.showModal();
        });

        this.btnClose.addEventListener('click', () => {
            if (history.state && history.state.settings === true) {
                history.back();
            } else {
                this.dialog.close();
            }
        });

        // Close when clicking outside of the dialog boundary
        this.dialog.addEventListener('click', (e) => {
            const rect = this.dialog.getBoundingClientRect();
            if (e.clientY < rect.top || e.clientY > rect.bottom || e.clientX < rect.left || e.clientX > rect.right) {
                if (history.state && history.state.settings === true) {
                    history.back();
                } else {
                    this.dialog.close();
                }
            }
        });

        this.dialog.addEventListener('close', () => {
            if (history.state && history.state.settings === true) {
                history.back();
            }
        });

        window.addEventListener('popstate', (e) => {
            if (this.dialog.open) {
                if (!e.state || e.state.settings !== true) {
                    this.dialog.close();
                }
            }
        });

        this.themeSelect.addEventListener('change', (e) => {
            this.app.setTheme(e.target.value);
        });

        this.directionSelect.addEventListener('change', (e) => {
            this.app.setWritingMode(e.target.value);
        });

        this.fontFamilySelect.addEventListener('change', (e) => {
            this.app.setFontFamily(e.target.value);
        });

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

        if (this.ttsModelSelect) {
            this.ttsModelSelect.addEventListener('change', async (e) => {
                const fullValue = e.target.value;
                if (!fullValue) return;
                // 格式可能是 'engine:voice' 或 'engine:model:sid'（sherpa 格式）
                const colonIdx = fullValue.indexOf(':');
                const engine = fullValue.substring(0, colonIdx);
                const voice = fullValue.substring(colonIdx + 1); // 保留完整的 voice 部分
                const oldEngine = this.app.ttsEngine;

                // Set model in app state
                this.app.setTTSModel(engine, voice);

                // Clear old engine cache if engine type changed
                if (oldEngine && oldEngine !== engine) {
                    await this.clearOldEngineCache(oldEngine);
                }
            });
        }

        if (this.btnSyncQr) {
            this.btnSyncQr.addEventListener('click', (e) => this.generateSyncQR(e));
        }

        if (this.btnGoogleLogin) {
            this.btnGoogleLogin.addEventListener('click', () => {
                if (this.app.gdrive) {
                    this.app.gdrive.handleAuthClick().then(() => {
                        this.app.showToast('Google 帳號登入成功');
                        this.syncUI(); // Update button states
                        this.app.checkAndSyncCloudProgress();
                    });
                }
            });
        }

        if (this.btnOpenReadingLog) {
            this.btnOpenReadingLog.addEventListener('click', () => {
                const sheetId = localStorage.getItem('zen_reader_sheet_id');
                if (sheetId) {
                    const a = document.createElement('a');
                    a.href = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
                    a.target = '_blank';
                    a.rel = 'noopener noreferrer';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                } else {
                    this.app.showToast('尚未建立或找到 Reading Log');
                }
            });
        }

        if (this.btnShowErrorLog) {
            this.btnShowErrorLog.addEventListener('click', () => {
                const logs = JSON.parse(localStorage.getItem('zen_app_error_log') || '[]');
                this.errorLogContent.textContent = logs.join('\n');
                this.errorLogDialog.showModal();
            });
        }

        if (this.btnClearCache) {
            this.btnClearCache.addEventListener('click', async () => {
                if (confirm('確定要清除所有離線快取嗎？（下次開啟時將需要重新下載模型與資源）')) {
                    if ('caches' in window) {
                        try {
                            const keys = await caches.keys();
                            await Promise.all(keys.map(key => caches.delete(key)));
                            this.app.showToast('離線快取已清除！請重新整理網頁。');
                        } catch (e) {
                            console.error('Clear cache error:', e);
                            this.app.showToast('清除快取失敗。');
                        }
                    }
                }
            });
        }

        if (this.btnCloseErrorLog) {
            this.btnCloseErrorLog.addEventListener('click', () => this.errorLogDialog.close());
        }

        if (this.btnClearErrorLog) {
            this.btnClearErrorLog.addEventListener('click', () => {
                localStorage.removeItem('zen_app_error_log');
                this.errorLogContent.textContent = '';
                this.app.showToast('已清除');
            });
        }

        // Transparency during slider interaction
        this.dialog.addEventListener('sliderstart', () => {
            this.dialog.classList.add('interacting');
            document.body.classList.add('settings-interacting');
            if (this.app && this.app.readingPanel) this.app.readingPanel.render();
        });
        this.dialog.addEventListener('sliderend', () => {
            this.dialog.classList.remove('interacting');
            document.body.classList.remove('settings-interacting');
            if (this.app && this.app.readingPanel) this.app.readingPanel.render();
        });
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

    async clearOldEngineCache(oldEngine) {
        if (!oldEngine) return;
        try {
            const cacheNames = await caches.keys();
            for (const name of cacheNames) {
                if (oldEngine === 'piper' && (name.includes('vits') || name.includes('piper'))) {
                    await caches.delete(name);
                    console.log(`[Cache Cleanup] Deleted Piper cache: ${name}`);
                }
                if (oldEngine === 'kokoro' && (name.includes('transformers') || name.includes('onnx') || name.includes('kokoro'))) {
                    await caches.delete(name);
                    console.log(`[Cache Cleanup] Deleted Kokoro cache: ${name}`);
                }
            }
        } catch (err) {
            console.warn('[Cache Cleanup] Failed to clear old engine cache:', err);
        }
    }

    async loadLocalFonts(silent = false) {
        try {
            const availableFonts = await window.queryLocalFonts();
            const fontSet = new Set();
            const fonts = [];
            
            for (const fontData of availableFonts) {
                if (!fontSet.has(fontData.family)) {
                    fontSet.add(fontData.family);
                    fonts.push(fontData.family);
                }
            }
            
            fonts.sort();
            
            while (this.fontFamilySelect.options.length > 3) {
                this.fontFamilySelect.remove(3);
            }
            
            for (const family of fonts) {
                const opt = document.createElement('option');
                opt.value = `"${family}", sans-serif`;
                opt.textContent = family;
                this.fontFamilySelect.appendChild(opt);
            }
            
            this.fontFamilySelect.value = this.app.currentFontFamily;
            if (this.btnLoadLocalFonts) {
                this.btnLoadLocalFonts.style.display = 'none';
            }
            
            if (!silent) this.app.showToast('本機字型載入成功！');
            
        } catch (err) {
            console.error(err);
            if (!silent) {
                this.app.showToast('無法存取本機字型，請確認權限是否允許。');
            }
        }
    }
}

window.ZenSettings = ZenSettings;
