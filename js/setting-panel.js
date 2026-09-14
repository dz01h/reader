class SettingPanel extends HTMLElement {
    constructor() {
        super();
        this.initComponent();
    }

}

window.SettingPanel = SettingPanel;
customElements.define('setting-panel', SettingPanel);

class RangeSlider extends HTMLElement {

    constructor() {
        super();
        this.initComponent();
    }

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

    initComponent() {
        this.className = 'custom-slider-track';

        this.fill = document.createElement('div');
        this.fill.className = 'custom-slider-fill';

        this.thumb = document.createElement('div');
        this.thumb.className = 'custom-slider-thumb';

        this.appendChild(this.fill);
        this.appendChild(this.thumb);

        this.bindEvents();
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

        this.addEventListener('mousedown', start);
        this.addEventListener('touchstart', start, { passive: false });
        window.addEventListener('mousemove', move, { passive: false });
        window.addEventListener('touchmove', move, { passive: false });
        window.addEventListener('mouseup', end);
        window.addEventListener('touchend', end);
    }
}

window.RangeSlider = RangeSlider;
customElements.define('range-slider', RangeSlider);
