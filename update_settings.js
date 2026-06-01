const fs = require('fs');

const code = fs.readFileSync('js/settings.js', 'utf8');

const prefix = `function throttleLayout(fn, delay = 100) {
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
        this.fill.style.width = \`\${pct}%\`;
        this.thumb.style.left = \`\${pct}%\`;
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

`;

let newCode = prefix + code;

newCode = newCode.replace(/this\.fontSizeInput = .*?;\s+this\.fontSizeDisplay = .*?;/, 
`this.fontSizeDisplay = document.getElementById('setting-font-size-display');
        this.fontSizeSlider = new CustomSlider(document.getElementById('setting-font-size'), throttleLayout(val => {
            this.fontSizeDisplay.textContent = \`\${val}px\`;
            this.app.setFontSize(val);
        }));`);

newCode = newCode.replace(/this\.lineHeightInput = .*?;\s+this\.lineHeightDisplay = .*?;/,
`this.lineHeightDisplay = document.getElementById('setting-line-height-display');
        this.lineHeightSlider = new CustomSlider(document.getElementById('setting-line-height'), throttleLayout(val => {
            this.lineHeightDisplay.textContent = val.toFixed(1);
            this.app.setLineHeight(val);
        }));`);

newCode = newCode.replace(/this\.marginTopInput = .*?;\s+this\.marginTopDisplay = .*?;/,
`this.marginTopDisplay = document.getElementById('setting-margin-top-display');
        this.marginTopSlider = new CustomSlider(document.getElementById('setting-margin-top'), throttleLayout(val => {
            this.marginTopDisplay.textContent = val;
            this.app.setMargins({ top: val });
        }));`);

newCode = newCode.replace(/this\.marginBottomInput = .*?;\s+this\.marginBottomDisplay = .*?;/,
`this.marginBottomDisplay = document.getElementById('setting-margin-bottom-display');
        this.marginBottomSlider = new CustomSlider(document.getElementById('setting-margin-bottom'), throttleLayout(val => {
            this.marginBottomDisplay.textContent = val;
            this.app.setMargins({ bottom: val });
        }));`);

newCode = newCode.replace(/this\.marginLeftInput = .*?;\s+this\.marginLeftDisplay = .*?;/,
`this.marginLeftDisplay = document.getElementById('setting-margin-left-display');
        this.marginLeftSlider = new CustomSlider(document.getElementById('setting-margin-left'), throttleLayout(val => {
            this.marginLeftDisplay.textContent = val;
            this.app.setMargins({ left: val });
        }));`);

newCode = newCode.replace(/this\.marginRightInput = .*?;\s+this\.marginRightDisplay = .*?;/,
`this.marginRightDisplay = document.getElementById('setting-margin-right-display');
        this.marginRightSlider = new CustomSlider(document.getElementById('setting-margin-right'), throttleLayout(val => {
            this.marginRightDisplay.textContent = val;
            this.app.setMargins({ right: val });
        }));`);

newCode = newCode.replace(/this\.ttsSpeedSlider = .*?;\s+this\.ttsSpeedDisplay = .*?;/,
`this.ttsSpeedDisplay = document.getElementById('setting-tts-speed-display');
        this.ttsSpeedSlider = new CustomSlider(document.getElementById('setting-tts-speed-slider'), val => {
            this.ttsSpeedDisplay.textContent = val.toFixed(1);
            this.app.setTTSSpeed(val);
        });`);

newCode = newCode.replace(/this\.fontSizeInput\.value = this\.app\.currentFontSize;/,
`if (this.fontSizeSlider) this.fontSizeSlider.setValue(this.app.currentFontSize);`);

newCode = newCode.replace(/this\.lineHeightInput\.value = this\.app\.currentLineHeight;/,
`if (this.lineHeightSlider) this.lineHeightSlider.setValue(this.app.currentLineHeight);`);

newCode = newCode.replace(/if \(this\.marginTopInput\) \{\s+this\.marginTopInput\.value = this\.app\.margins\.top;\s+this\.marginTopDisplay\.textContent = this\.app\.margins\.top;\s+\}/,
`if (this.marginTopSlider) {
                this.marginTopSlider.setValue(this.app.margins.top);
                this.marginTopDisplay.textContent = this.app.margins.top;
            }`);

newCode = newCode.replace(/if \(this\.marginBottomInput\) \{\s+this\.marginBottomInput\.value = this\.app\.margins\.bottom;\s+this\.marginBottomDisplay\.textContent = this\.app\.margins\.bottom;\s+\}/,
`if (this.marginBottomSlider) {
                this.marginBottomSlider.setValue(this.app.margins.bottom);
                this.marginBottomDisplay.textContent = this.app.margins.bottom;
            }`);

newCode = newCode.replace(/if \(this\.marginLeftInput\) \{\s+this\.marginLeftInput\.value = this\.app\.margins\.left;\s+this\.marginLeftDisplay\.textContent = this\.app\.margins\.left;\s+\}/,
`if (this.marginLeftSlider) {
                this.marginLeftSlider.setValue(this.app.margins.left);
                this.marginLeftDisplay.textContent = this.app.margins.left;
            }`);

newCode = newCode.replace(/if \(this\.marginRightInput\) \{\s+this\.marginRightInput\.value = this\.app\.margins\.right;\s+this\.marginRightDisplay\.textContent = this\.app\.margins\.right;\s+\}/,
`if (this.marginRightSlider) {
                this.marginRightSlider.setValue(this.app.margins.right);
                this.marginRightDisplay.textContent = this.app.margins.right;
            }`);

newCode = newCode.replace(/if \(this\.ttsSpeedSlider\) \{\s+this\.ttsSpeedSlider\.value = this\.app\.ttsSpeed \|\| 1\.0;\s+this\.ttsSpeedDisplay\.textContent = \(this\.app\.ttsSpeed \|\| 1\.0\)\.toFixed\(1\);\s+\}/,
`if (this.ttsSpeedSlider) {
            this.ttsSpeedSlider.setValue(this.app.ttsSpeed || 1.0);
            this.ttsSpeedDisplay.textContent = (this.app.ttsSpeed || 1.0).toFixed(1);
        }`);

newCode = newCode.replace(/this\.fontSizeInput\.addEventListener\([\s\S]*?\}\);/g, '');
newCode = newCode.replace(/this\.lineHeightInput\.addEventListener\([\s\S]*?\}\);/g, '');
newCode = newCode.replace(/if \(this\.marginTopInput\) \{[\s\S]*?\}\);[\s\n]*\}/g, '');
newCode = newCode.replace(/if \(this\.marginBottomInput\) \{[\s\S]*?\}\);[\s\n]*\}/g, '');
newCode = newCode.replace(/if \(this\.marginLeftInput\) \{[\s\S]*?\}\);[\s\n]*\}/g, '');
newCode = newCode.replace(/if \(this\.marginRightInput\) \{[\s\S]*?\}\);[\s\n]*\}/g, '');
newCode = newCode.replace(/if \(this\.ttsSpeedSlider\) \{[\s\S]*?\}\);[\s\n]*\}/g, '');

const interactionRegex = /\/\/ Transparency during slider interaction[\s\S]*?window\.addEventListener\('touchend', stopInteracting\);/;
newCode = newCode.replace(interactionRegex, 
`// Transparency during slider interaction
        this.dialog.addEventListener('sliderstart', () => {
            this.dialog.classList.add('interacting');
        });
        this.dialog.addEventListener('sliderend', () => {
            this.dialog.classList.remove('interacting');
        });`);

fs.writeFileSync('js/settings.js', newCode);
