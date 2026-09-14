function throttleLayout(fn, limit = 50) {
    let inThrottle = false;
    let lastArgs = null;
    return function (...args) {
        lastArgs = args;
        if (!inThrottle) {
            fn.apply(this, args);
            inThrottle = true;
            setTimeout(() => {
                inThrottle = false;
                if (lastArgs) {
                    fn.apply(this, lastArgs);
                    lastArgs = null;
                }
            }, limit);
        }
    };
}

class CustomSlider {
    constructor(containerEl, onChange) {
        this.el = containerEl;
        this.onChange = onChange;
        this.min = parseFloat(this.el.dataset.min || 0);
        this.max = parseFloat(this.el.dataset.max || 100);
        this.step = parseFloat(this.el.dataset.step || 1);
        this.value = this.min;

        this.initDOM();
        this.bindEvents();
    }

    initDOM() {
        this.el.innerHTML = '';
        this.track = document.createElement('div');
        this.track.className = 'custom-slider-track';

        this.fill = document.createElement('div');
        this.fill.className = 'custom-slider-fill';

        this.thumb = document.createElement('div');
        this.thumb.className = 'custom-slider-thumb';

        this.track.appendChild(this.fill);
        this.track.appendChild(this.thumb);
        this.el.appendChild(this.track);
    }

    setValue(val, trigger = true) {
        val = Math.max(this.min, Math.min(this.max, val));
        if (this.step > 0) {
            const steps = Math.round((val - this.min) / this.step);
            val = this.min + steps * this.step;
            val = parseFloat(val.toFixed(4));
        }

        if (this.value !== val) {
            this.value = val;
            this.updateVisuals();
            if (trigger && this.onChange) this.onChange(this.value);
        }
    }

    updateVisuals() {
        const range = this.max - this.min;
        const pct = range > 0 ? ((this.value - this.min) / range) * 100 : 0;
        this.fill.style.width = `${pct}%`;
        this.thumb.style.left = `${pct}%`;
    }

    handleMove(clientX) {
        const rect = this.el.getBoundingClientRect();
        if (rect.width <= 0) return;
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

class SettingPanel extends HTMLElement {
    constructor() {
        super();
        this.sliders = {};
        this.selects = {};
        this.displays = {};
        this.buttons = {};
        this.schema = null;
        this.dialog = null;
    }

    get app() {
        return window._app || window.readerApp || null;
    }

    connectedCallback() {
        this.dialog = this.closest('dialog') || document.getElementById('settings-dialog');
        
        let schema = {};
        try {
            const rawText = this.textContent.trim();
            if (rawText) {
                schema = JSON.parse(rawText);
            }
        } catch (err) {
            console.error('Failed to parse SettingPanel JSON schema:', err);
        }
        this.schema = schema;

        this.innerHTML = '';
        this.buildUI(schema);
        this.bindEvents();

        if (window._app) {
            window._app.settings = this;
        }
    }

    buildUI(schema) {
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
        this.appendChild(header);

        // 2. Body
        const body = document.createElement('div');
        body.className = 'dialog-body';
        this.appendChild(body);

        // Render each section in schema
        for (const [key, item] of Object.entries(schema)) {
            this.renderSchemaItem(key, item, body);
        }

        // Initialize elements
        this.initElements();
    }

    renderSchemaItem(key, item, container, isHalf = false) {
        const type = item.type || (item.options ? 'select' : 'group');

        if (type === 'fieldset') {
            const fieldset = document.createElement('fieldset');
            fieldset.className = 'setting-fieldset';
            if (item.legend) {
                const legend = document.createElement('legend');
                if (item.legendKey) legend.setAttribute('data-i18n', item.legendKey);
                legend.textContent = item.legend;
                fieldset.appendChild(legend);
            }

            if (item.layout === 'row' || item.layout === 'grid') {
                const entries = Object.entries(item.fields || {});
                for (let i = 0; i < entries.length; i += 2) {
                    const row = document.createElement('div');
                    row.className = 'setting-group-row';
                    const [k1, f1] = entries[i];
                    this.renderSchemaItem(k1, f1, row, true);
                    if (i + 1 < entries.length) {
                        const [k2, f2] = entries[i + 1];
                        this.renderSchemaItem(k2, f2, row, true);
                    }
                    fieldset.appendChild(row);
                }
            } else {
                for (const [subKey, subItem] of Object.entries(item.fields || {})) {
                    this.renderSchemaItem(subKey, subItem, fieldset, false);
                }
            }
            container.appendChild(fieldset);
            return;
        }

        if (type === 'select') {
            const group = document.createElement('div');
            group.className = isHalf ? 'setting-group half' : 'setting-group';

            const label = document.createElement('label');
            const selectId = `setting-${key}`;
            label.htmlFor = selectId;
            if (item.labelKey) label.setAttribute('data-i18n', item.labelKey);
            label.textContent = item.label || key;
            group.appendChild(label);

            const select = document.createElement('select');
            select.id = selectId;
            select.dataset.binding = item.binding || key;

            for (const [optVal, optLabel] of Object.entries(item.options || {})) {
                const opt = document.createElement('option');
                opt.value = optVal;
                opt.textContent = optLabel;
                select.appendChild(opt);
            }
            group.appendChild(select);

            if (item.extraButton) {
                const btn = document.createElement('button');
                btn.id = item.extraButton.id;
                btn.className = 'btn btn-secondary';
                btn.style.cssText = 'margin-top: 10px; width: 100%; display: none;';
                btn.textContent = item.extraButton.text;
                btn.dataset.action = item.extraButton.action;
                group.appendChild(btn);
            }

            container.appendChild(group);
            return;
        }

        if (type === 'slider') {
            const group = document.createElement('div');
            group.className = isHalf ? 'setting-group half' : 'setting-group';

            const label = document.createElement('label');
            const labelSpan = document.createElement('span');
            if (item.labelKey) labelSpan.setAttribute('data-i18n', item.labelKey);
            labelSpan.textContent = `${item.label || key}: `;
            label.appendChild(labelSpan);

            const dispSpan = document.createElement('span');
            dispSpan.id = `setting-${key}-display`;
            label.appendChild(dispSpan);
            group.appendChild(label);

            const slider = document.createElement('div');
            slider.className = 'custom-slider';
            slider.id = `setting-${key}`;
            slider.dataset.min = item.min ?? 0;
            slider.dataset.max = item.max ?? 100;
            slider.dataset.step = item.step ?? 1;
            slider.dataset.unit = item.unit || '';
            slider.dataset.binding = item.binding || key;
            group.appendChild(slider);

            container.appendChild(group);
            return;
        }

        if (type === 'ttsModelSelect') {
            const group = document.createElement('div');
            group.className = 'setting-group';

            const label = document.createElement('label');
            label.htmlFor = 'setting-tts-model';
            if (item.labelKey) label.setAttribute('data-i18n', item.labelKey);
            label.textContent = item.label || '語音引擎與模型';
            group.appendChild(label);

            const select = document.createElement('select');
            select.id = 'setting-tts-model';
            select.style.width = '100%';
            select.dataset.binding = 'ttsModel';
            group.appendChild(select);

            container.appendChild(group);
            return;
        }

        if (type === 'button') {
            const group = document.createElement('div');
            group.className = 'setting-group';

            const btn = document.createElement('button');
            btn.id = item.id || `btn-${key}`;
            btn.className = `btn-primary ${item.danger ? 'btn-danger' : ''}`;
            btn.style.cssText = `width: 100%; margin-top: 0.5rem; ${item.danger ? 'background-color: #d9534f;' : ''} ${item.style || ''}`;
            if (item.textKey) btn.setAttribute('data-i18n', item.textKey);
            btn.textContent = item.text || key;
            btn.dataset.action = item.action || key;
            group.appendChild(btn);

            container.appendChild(group);
            return;
        }

        if (type === 'container') {
            const div = document.createElement('div');
            div.id = item.id || key;
            if (item.class) div.className = item.class;
            div.style.cssText = item.style || 'margin-top: 1rem; text-align: center; background: white; padding: 1rem; border-radius: 8px;';
            div.innerHTML = item.html || '';
            container.appendChild(div);
            return;
        }
    }

    initElements() {
        this.btnOpen = document.getElementById('btn-open-settings');
        this.btnClose = document.getElementById('btn-close-settings');

        this.themeSelect = document.getElementById('setting-themeSelect');
        this.directionSelect = document.getElementById('setting-directionSelect');
        this.fontFamilySelect = document.getElementById('setting-fontFamilySelect');
        this.langSelect = document.getElementById('setting-langSelect');
        this.btnLoadLocalFonts = document.getElementById('btn-load-local-fonts');

        this.quadTLSelect = document.getElementById('setting-quadTL');
        this.quadTRSelect = document.getElementById('setting-quadTR');
        this.quadBLSelect = document.getElementById('setting-quadBL');
        this.quadBRSelect = document.getElementById('setting-quadBR');

        this.ttsModelSelect = document.getElementById('setting-tts-model');
        this.syncCooldownSelect = document.getElementById('setting-syncCooldown');

        this.btnSyncQr = document.getElementById('btn-sync-qr') || document.getElementById('btn-btnSyncQr');
        this.btnGoogleLogin = document.getElementById('btn-google-login') || document.getElementById('btn-btnGoogleLogin');
        this.btnOpenReadingLog = document.getElementById('btn-open-reading-log') || document.getElementById('btn-btnOpenReadingLog');
        this.btnShowErrorLog = document.getElementById('btn-show-error-log') || document.getElementById('btn-btnShowErrorLog');
        this.btnClearCache = document.getElementById('btn-clear-cache') || document.getElementById('btn-btnClearCache');

        this.qrContainer = document.getElementById('qr-container') || document.getElementById('qrContainer');
        this.qrCodeEl = document.getElementById('qr-code');

        this.errorLogDialog = document.getElementById('error-log-dialog');
        this.errorLogContent = document.getElementById('error-log-content');
        this.btnCloseErrorLog = document.getElementById('btn-close-error-log');
        this.btnClearErrorLog = document.getElementById('btn-clear-error-log');

        // Sliders initialization
        const sliderEls = this.querySelectorAll('.custom-slider');
        sliderEls.forEach(sliderEl => {
            const binding = sliderEl.dataset.binding;
            const unit = sliderEl.dataset.unit || '';
            const dispEl = document.getElementById(`${sliderEl.id}-display`);

            const onChange = throttleLayout((val) => {
                if (dispEl) {
                    dispEl.textContent = sliderEl.dataset.step < 1 ? `${val.toFixed(1)}${unit}` : `${val}${unit}`;
                }
                this.applyBinding(binding, val);
            });

            const cs = new CustomSlider(sliderEl, onChange);
            this.sliders[binding] = { slider: cs, display: dispEl, unit, step: parseFloat(sliderEl.dataset.step || 1) };
        });

        // Local fonts API support
        if (this.btnLoadLocalFonts && 'queryLocalFonts' in window) {
            this.btnLoadLocalFonts.style.display = 'block';
            this.btnLoadLocalFonts.addEventListener('click', () => this.loadLocalFonts());

            if (navigator.permissions && navigator.permissions.query) {
                navigator.permissions.query({ name: 'local-fonts' }).then(result => {
                    if (result.state === 'granted') {
                        this.loadLocalFonts(true);
                    }
                }).catch(err => console.log('local-fonts permission query failed:', err));
            }
        }
    }

    applyBinding(binding, val) {
        if (!this.app) return;
        switch (binding) {
            case 'fontSize':
                this.app.setFontSize(val);
                break;
            case 'lineHeight':
                this.app.setLineHeight(val);
                break;
            case 'margins.top':
                this.app.setMargins({ top: val });
                break;
            case 'margins.bottom':
                this.app.setMargins({ bottom: val });
                break;
            case 'margins.left':
                this.app.setMargins({ left: val });
                break;
            case 'margins.right':
                this.app.setMargins({ right: val });
                break;
            case 'ttsSpeed':
                this.app.setTTSSpeed(val);
                break;
            default:
                break;
        }
    }

    syncUI() {
        if (!this.app) return;

        if (this.themeSelect) {
            this.themeSelect.value = document.documentElement.getAttribute('data-theme') || 'dark';
        }
        if (this.directionSelect) {
            this.directionSelect.value = this.app.currentWritingMode;
        }
        if (this.fontFamilySelect) {
            this.fontFamilySelect.value = this.app.currentFontFamily;
        }
        if (this.langSelect && this.app.i18n) {
            this.langSelect.value = this.app.i18n.lang;
        }

        // Sliders sync
        const setSliderVal = (binding, val) => {
            const item = this.sliders[binding];
            if (item && item.slider) {
                item.slider.setValue(val, false);
                if (item.display) {
                    item.display.textContent = item.step < 1 ? `${val.toFixed(1)}${item.unit}` : `${val}${item.unit}`;
                }
            }
        };

        setSliderVal('fontSize', this.app.currentFontSize);
        setSliderVal('lineHeight', this.app.currentLineHeight);

        if (this.app.margins) {
            setSliderVal('margins.top', this.app.margins.top);
            setSliderVal('margins.bottom', this.app.margins.bottom);
            setSliderVal('margins.left', this.app.margins.left);
            setSliderVal('margins.right', this.app.margins.right);
        }

        if (this.quadTLSelect) this.quadTLSelect.value = this.app.quadTL || 'prev';
        if (this.quadTRSelect) this.quadTRSelect.value = this.app.quadTR || 'next';
        if (this.quadBLSelect) this.quadBLSelect.value = this.app.quadBL || 'prev';
        if (this.quadBRSelect) this.quadBRSelect.value = this.app.quadBR || 'next';

        setSliderVal('ttsSpeed', this.app.ttsSpeed || 1.0);

        if (this.syncCooldownSelect) {
            this.syncCooldownSelect.value = this.app.syncCooldown || 15;
        }

        this.updateModelDropdown();

        // Google login & GDrive state
        const hasAuth = !!(this.app.gdrive && this.app.gdrive.isAuthenticated);
        if (this.btnSyncQr) {
            this.btnSyncQr.disabled = !hasAuth;
            this.btnSyncQr.style.opacity = hasAuth ? '1' : '0.5';
        }
        if (this.syncCooldownSelect) {
            this.syncCooldownSelect.disabled = !hasAuth;
        }
        if (this.btnGoogleLogin) {
            this.btnGoogleLogin.textContent = hasAuth ? '已登入 Google (點此重新授權)' : '登入 Google 帳號';
        }
        if (this.btnOpenReadingLog) {
            this.btnOpenReadingLog.style.display = hasAuth ? 'block' : 'none';
        }
    }

    updateModelDropdown() {
        if (!this.ttsModelSelect || !this.app) return;

        const currentSelection = this.ttsModelSelect.value || `${this.app.ttsEngine || 'piper'}:${this.app.ttsVoice || 'zh_CN-huayan-medium'}`;
        this.ttsModelSelect.innerHTML = '';

        // Matcha Group
        const matchaGroup = document.createElement('optgroup');
        matchaGroup.label = 'Matcha TTS (語音引擎)';
        const matchaVoices = [
            { value: 'matcha:matcha-icefall-zh-baker:0', name: 'Matcha Baker (高速中文)' },
            { value: 'matcha:matcha-icefall-zh-en:0', name: 'Matcha 中英雙語 (高速)' }
        ];
        matchaVoices.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v.value;
            opt.textContent = v.name;
            matchaGroup.appendChild(opt);
        });
        this.ttsModelSelect.appendChild(matchaGroup);

        // WebSpeech Group
        if ('speechSynthesis' in window) {
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
        }

        // Restore selection or fallback
        const options = Array.from(this.ttsModelSelect.options || this.ttsModelSelect.children || []);
        const hasOption = options.some(o => o.value === currentSelection);
        if (hasOption) {
            this.ttsModelSelect.value = currentSelection;
        } else if (options.length > 0 && options[0].value) {
            this.ttsModelSelect.value = options[0].value;
            const fbVal = this.ttsModelSelect.value;
            if (fbVal && typeof fbVal === 'string') {
                const fbIdx = fbVal.indexOf(':');
                if (fbIdx > 0) {
                    this.app.setTTSModel(fbVal.substring(0, fbIdx), fbVal.substring(fbIdx + 1));
                }
            }
        }
    }

    bindEvents() {
        if (this.btnOpen) {
            this.btnOpen.addEventListener('click', () => {
                this.syncUI();
                if (!history.state || history.state.settings !== true) {
                    history.pushState({ ...history.state, settings: true }, '', '#settings');
                }
                if (this.dialog && typeof this.dialog.showModal === 'function') {
                    this.dialog.showModal();
                }
            });
        }

        if (this.btnClose) {
            this.btnClose.addEventListener('click', () => {
                if (history.state && history.state.settings === true) {
                    history.back();
                } else if (this.dialog) {
                    this.dialog.close();
                }
            });
        }

        if (this.dialog) {
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

        window.addEventListener('popstate', (e) => {
            if (this.dialog && this.dialog.open) {
                if (!e.state || e.state.settings !== true) {
                    this.dialog.close();
                }
            }
        });

        // Event bindings for selects
        if (this.themeSelect) {
            this.themeSelect.addEventListener('change', (e) => this.app && this.app.setTheme(e.target.value));
        }
        if (this.directionSelect) {
            this.directionSelect.addEventListener('change', (e) => this.app && this.app.setWritingMode(e.target.value));
        }
        if (this.fontFamilySelect) {
            this.fontFamilySelect.addEventListener('change', (e) => this.app && this.app.setFontFamily(e.target.value));
        }
        if (this.langSelect) {
            this.langSelect.addEventListener('change', (e) => this.app && this.app.setLanguage(e.target.value));
        }

        if (this.quadTLSelect) this.quadTLSelect.addEventListener('change', (e) => this.app && this.app.setQuad('TL', e.target.value));
        if (this.quadTRSelect) this.quadTRSelect.addEventListener('change', (e) => this.app && this.app.setQuad('TR', e.target.value));
        if (this.quadBLSelect) this.quadBLSelect.addEventListener('change', (e) => this.app && this.app.setQuad('BL', e.target.value));
        if (this.quadBRSelect) this.quadBRSelect.addEventListener('change', (e) => this.app && this.app.setQuad('BR', e.target.value));

        if (this.syncCooldownSelect) {
            this.syncCooldownSelect.addEventListener('change', (e) => this.app && this.app.setSyncCooldown(e.target.value));
        }

        if (this.ttsModelSelect) {
            this.ttsModelSelect.addEventListener('change', async (e) => {
                if (!this.app) return;
                const fullValue = e.target.value;
                if (!fullValue) return;
                const colonIdx = fullValue.indexOf(':');
                const engine = fullValue.substring(0, colonIdx);
                const voice = fullValue.substring(colonIdx + 1);
                const oldEngine = this.app.ttsEngine;

                this.app.setTTSModel(engine, voice);

                if (oldEngine && oldEngine !== engine) {
                    await this.clearOldEngineCache(oldEngine);
                }
            });
        }

        // Action buttons
        if (this.btnSyncQr) {
            this.btnSyncQr.addEventListener('click', (e) => this.generateSyncQR(e));
        }
        if (this.btnGoogleLogin) {
            this.btnGoogleLogin.addEventListener('click', () => this.googleLogin());
        }
        if (this.btnOpenReadingLog) {
            this.btnOpenReadingLog.addEventListener('click', () => this.openReadingLog());
        }
        if (this.btnShowErrorLog) {
            this.btnShowErrorLog.addEventListener('click', () => this.showErrorLog());
        }
        if (this.btnClearCache) {
            this.btnClearCache.addEventListener('click', () => this.clearCache());
        }

        if (this.btnCloseErrorLog && this.errorLogDialog) {
            this.btnCloseErrorLog.addEventListener('click', () => this.errorLogDialog.close());
        }
        if (this.btnClearErrorLog && this.errorLogContent) {
            this.btnClearErrorLog.addEventListener('click', () => {
                localStorage.removeItem('zen_app_error_log');
                this.errorLogContent.textContent = '';
                if (this.app) this.app.showToast('已清除');
            });
        }
    }

    googleLogin() {
        if (this.app && this.app.gdrive) {
            this.app.gdrive.handleAuthClick().then(() => {
                this.app.showToast('Google 帳號登入成功');
                this.syncUI();
                this.app.checkAndSyncCloudProgress();
            });
        }
    }

    openReadingLog() {
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
            if (this.app) this.app.showToast('尚未建立或找到 Reading Log');
        }
    }

    showErrorLog() {
        if (!this.errorLogDialog) return;
        const logs = JSON.parse(localStorage.getItem('zen_app_error_log') || '[]');
        if (this.errorLogContent) {
            this.errorLogContent.textContent = logs.join('\n');
        }
        this.errorLogDialog.showModal();
    }

    async clearCache() {
        if (confirm('確定要清除所有離線快取嗎？（下次開啟時將需要重新下載模型與資源）')) {
            if ('caches' in window) {
                try {
                    const keys = await caches.keys();
                    await Promise.all(keys.map(key => caches.delete(key)));
                    if (this.app) this.app.showToast('離線快取已清除！請重新整理網頁。');
                } catch (e) {
                    console.error('Clear cache error:', e);
                    if (this.app) this.app.showToast('清除快取失敗。');
                }
            }
        }
    }

    generateSyncQR(e) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        if (!this.qrContainer || !this.qrCodeEl) return;

        if (this.qrContainer.classList.contains('hidden')) {
            this.qrContainer.classList.remove('hidden');
            this.qrCodeEl.innerHTML = '';
            const state = {
                lang: this.app && this.app.i18n ? this.app.i18n.lang : 'zh-TW',
                theme: document.documentElement.getAttribute('data-theme') || 'dark',
                fontSize: this.app ? this.app.currentFontSize : 18,
                lineHeight: this.app ? this.app.currentLineHeight : 1.8,
                margins: this.app ? this.app.margins : { top: 30, bottom: 30, left: 30, right: 30 }
            };

            const payload = btoa(JSON.stringify(state));
            const baseUrl = window.location.origin + window.location.pathname;
            const syncUrl = `${baseUrl}?sync=${payload}`;

            if (typeof QRCode !== 'undefined') {
                new QRCode(this.qrCodeEl, {
                    text: syncUrl,
                    width: 200,
                    height: 200,
                    colorDark: '#000000',
                    colorLight: '#ffffff',
                    correctLevel: QRCode.CorrectLevel.L
                });
            }
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

            if (this.fontFamilySelect) {
                while (this.fontFamilySelect.options.length > 3) {
                    this.fontFamilySelect.remove(3);
                }

                for (const family of fonts) {
                    const opt = document.createElement('option');
                    opt.value = `"${family}", sans-serif`;
                    opt.textContent = family;
                    this.fontFamilySelect.appendChild(opt);
                }

                if (this.app) {
                    this.fontFamilySelect.value = this.app.currentFontFamily;
                }
            }

            if (this.btnLoadLocalFonts) {
                this.btnLoadLocalFonts.style.display = 'none';
            }

            if (!silent && this.app) this.app.showToast('本機字型載入成功！');
        } catch (err) {
            console.error(err);
            if (!silent && this.app) {
                this.app.showToast('無法存取本機字型，請確認權限是否允許。');
            }
        }
    }
}

window.SettingPanel = SettingPanel;
window.ZenSettings = SettingPanel;
customElements.define('setting-panel', SettingPanel);
