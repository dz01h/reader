class RangeSlider extends Component {

    static DEFAULT_STYLE = `
        :host {
            position: relative;
            width: 100%;
            display: flex;
            align-items: center;
            font-size: 0.95rem;
            cursor: pointer;
            touch-action: none;
            user-select: none;
            flex-wrap: wrap;
            line-height: 2.5;
        }
        :host::before {
            content: attr(label);
            display: inline;
            min-height: 32px;
        }
        :host::after {
            content: attr(value);
            content: attr(value);
            position: absolute;
            right: 1rem;
            top: 0;
        }
        .custom-slider-track {
            position: relative;
            width: 100%;
            height: 6px;
            background: var(--color-border);
            border-radius: 3px;
            margin-bottom: 10px;
        }
        .custom-slider-fill {
            position: absolute;
            top: 0; left: 0; bottom: 0;
            background: var(--color-primary);
            border-radius: 3px;
            pointer-events: none;
        }
        .custom-slider-thumb {
            position: absolute;
            top: 50%;
            transform: translate(-50%, -50%);
            width: 20px;
            height: 20px;
            background: var(--color-surface);
            border: 2px solid var(--color-primary);
            border-radius: 50%;
            box-shadow: var(--shadow-sm);
            pointer-events: none;
            transition: transform 0.1s, box-shadow 0.1s;
        }
        .custom-slider.active .custom-slider-thumb {
            transform: translate(-50%, -50%) scale(1.2);
            box-shadow: var(--shadow-md);
        }
    `;

    static get observedAttributes() {
        return ['min', 'max', 'step', 'value'];
    }

    constructor() {
        super();
        this._min = 0;
        this._max = 100;
        this._step = 1;
        this._value = 0;
        this.isDragging = false;
        this.activePointerId = null;

        this.initComponent();
    }

    get min() { return this._min; }
    set min(val) {
        this._min = parseFloat(val) || 0;
        this.updateVisuals();
    }

    get max() { return this._max; }
    set max(val) {
        this._max = parseFloat(val) || 100;
        this.updateVisuals();
    }

    get step() { return this._step; }
    set step(val) {
        this._step = parseFloat(val) || 1;
    }

    get value() { return this._value; }
    set value(val) {
        this.setValue(val, false, false);
    }

    attributeChangedCallback(name, oldVal, newVal) {
        if (oldVal === newVal) return;
        if (name === 'min') this._min = parseFloat(newVal || 0);
        if (name === 'max') this._max = parseFloat(newVal || 100);
        if (name === 'step') this._step = parseFloat(newVal || 1);
        if (name === 'value') this.setValue(newVal, false, false);
    }

    initComponent() {
        if (this.hasAttribute('min')) this._min = parseFloat(this.getAttribute('min')) || 0;
        if (this.hasAttribute('max')) this._max = parseFloat(this.getAttribute('max')) || 100;
        if (this.hasAttribute('step')) this._step = parseFloat(this.getAttribute('step')) || 1;
        if (this.hasAttribute('value')) {
            this._value = parseFloat(this.getAttribute('value')) || this._min;
        } else {
            this._value = this._min;
        }

        const host = this.attachShadow({ mode: 'open' });

        const innerStyle = new CSSStyleSheet();
        innerStyle.replaceSync(RangeSlider.DEFAULT_STYLE);
        host.adoptedStyleSheets =[innerStyle];

        // Track, Fill and Thumb DOM Structure
        this.track = document.createElement('div');
        this.track.className = 'custom-slider-track';

        this.fill = document.createElement('div');
        this.fill.className = 'custom-slider-fill';

        this.thumb = document.createElement('div');
        this.thumb.className = 'custom-slider-thumb';

        this.track.appendChild(this.fill);
        this.track.appendChild(this.thumb);
        host.appendChild(this.track);

        this.updateVisuals();
        this.bindEvents();
    }

    setValue(val, triggerInput = false, triggerChange = false) {
        let num = parseFloat(val);
        if (isNaN(num)) num = this._min;
        num = Math.max(this._min, Math.min(this._max, num));

        if (this._step > 0) {
            const steps = Math.round((num - this._min) / this._step);
            num = this._min + steps * this._step;
            num = parseFloat(num.toFixed(4));
        }

        const changed = this._value !== num;
        this._value = num;
        this.updateVisuals();

        let event = null;
        if(triggerInput)    event = typeof InputEvent !== 'undefined' ? new InputEvent('input', { bubbles: true }) : new Event('input', { bubbles: true });
        if(triggerChange)   event = new Event('change', { bubbles: true });
        if(event) {
            queueMicrotask(() => { this.dispatchEvent(event); });
            this.fireEvent('settingUpdated', {
                field: this.getAttribute('field'),
                value: this._value,
                isCommit: !!triggerChange
            }, true);
        }

        return changed;
    }

    updateVisuals() {
        if (!this.fill || !this.thumb) return;
        const range = this._max - this._min;
        const pct = range > 0 ? Math.max(0, Math.min(100, ((this._value - this._min) / range) * 100)) : 0;
        this.fill.style.width = `${pct}%`;
        this.thumb.style.left = `${pct}%`;
        this.setAttribute('value', this._value);
    }

    handleMove(clientX, isCommit = false) {
        const rect = this.getBoundingClientRect();
        if (rect.width <= 0) return;
        let pct = (clientX - rect.left) / rect.width;
        pct = Math.max(0, Math.min(1, pct));
        const rawVal = this._min + pct * (this._max - this._min);
        this.setValue(rawVal, !isCommit, isCommit);
    }

    bindEvents() {
        this.addEventListener('pointerdown', (e) => this.onPointerDown(e));
        this.addEventListener('pointermove', (e) => this.onPointerMove(e));
        this.addEventListener('pointerup', (e) => this.onPointerUp(e));
        this.addEventListener('pointercancel', (e) => this.onPointerCancel(e));
    }

    onPointerDown(e) {
        if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;

        try {
            this.setPointerCapture(e.pointerId);
        } catch (err) {}

        this.isDragging = true;
        this.activePointerId = e.pointerId;
        this.classList.add('active');

        this.dispatchEvent(new CustomEvent('sliderstart', { bubbles: true }));
        this.handleMove(e.clientX, false);
    }

    onPointerMove(e) {
        if (!this.isDragging || (this.activePointerId !== null && e.pointerId !== this.activePointerId)) return;
        if (e.cancelable) e.preventDefault();

        this.handleMove(e.clientX, false);
    }

    onPointerUp(e) {
        if (!this.isDragging || (this.activePointerId !== null && e.pointerId !== this.activePointerId)) return;
        this.isDragging = false;

        try {
            if (this.hasPointerCapture && this.hasPointerCapture(e.pointerId)) {
                this.releasePointerCapture(e.pointerId);
            }
        } catch (err) {}

        this.activePointerId = null;
        this.classList.remove('active');

        this.handleMove(e.clientX, true);
        this.dispatchEvent(new CustomEvent('sliderend', { bubbles: true }));
    }

    onPointerCancel(e) {
        if (!this.isDragging || (this.activePointerId !== null && e.pointerId !== this.activePointerId)) return;
        this.isDragging = false;

        try {
            if (this.hasPointerCapture && this.hasPointerCapture(e.pointerId)) {
                this.releasePointerCapture(e.pointerId);
            }
        } catch (err) {}

        this.activePointerId = null;
        this.classList.remove('active');

        this.handleMove(e.clientX || 0, true);
        this.dispatchEvent(new CustomEvent('sliderend', { bubbles: true }));
    }
}

window.RangeSlider = RangeSlider;
customElements.define('range-slider', RangeSlider);
