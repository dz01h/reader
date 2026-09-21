class ActionButton extends Component {
    static get observedAttributes() {
        return ['action', 'disabled', 'variant'];
    }

    constructor() {
        super();
        this.initComponent();
    }

    get action() {
        return this.getAttribute('action') || '';
    }

    set action(val) {
        if (val) {
            this.setAttribute('action', val);
        } else {
            this.removeAttribute('action');
        }
    }

    get disabled() {
        return this.hasAttribute('disabled');
    }

    set disabled(val) {
        if (val) {
            this.setAttribute('disabled', '');
        } else {
            this.removeAttribute('disabled');
        }
    }

    attributeChangedCallback(name, oldVal, newVal) {
        if (oldVal === newVal) return;
        if (name === 'disabled') {
            if (this.hasAttribute('disabled')) {
                this.setAttribute('tabindex', '-1');
                this.setAttribute('aria-disabled', 'true');
            } else {
                this.setAttribute('tabindex', '0');
                this.removeAttribute('aria-disabled');
            }
        }
    }

    initComponent() {
        this.classList.add('action-button');
        if (!this.hasAttribute('role')) {
            this.setAttribute('role', 'button');
        }
        if (!this.hasAttribute('tabindex')) {
            this.setAttribute('tabindex', this.hasAttribute('disabled') ? '-1' : '0');
        }
        this.bindEvents();
    }

    triggerAction() {
        if (this.hasAttribute('disabled')) return;
        const action = this.getAttribute('action');
        if (!action) return;

        const detail = {
            action: action
        };

        // Dispatch on the button itself (bubbles up)
        this.fireEvent('ActionPerformed', detail, true);
    }

    bindEvents() {
        this.addEventListener('pointerdown', (e) => {
            if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
            if (this.hasAttribute('disabled')) return;
            this.classList.add('active');
            if (this.setPointerCapture && e.pointerId != null) {
                try {
                    this.setPointerCapture(e.pointerId);
                } catch (_) {}
            }
        });

        this.addEventListener('pointerup', (e) => {
            if (this.hasAttribute('disabled')) return;
            const wasActive = this.classList.contains('active');
            this.classList.remove('active');
            if (this.releasePointerCapture && e.pointerId != null) {
                try {
                    this.releasePointerCapture(e.pointerId);
                } catch (_) {}
            }

            if (wasActive) {
                if (typeof this.getBoundingClientRect === 'function') {
                    const rect = this.getBoundingClientRect();
                    if (
                        e.clientX >= rect.left &&
                        e.clientX <= rect.right &&
                        e.clientY >= rect.top &&
                        e.clientY <= rect.bottom
                    ) {
                        this.triggerAction();
                        return;
                    }
                }
                // If bounding rect is 0 (e.g. in headless / synthetic test), fallback trigger
                if (typeof window !== 'undefined' && (!this.offsetWidth && !this.offsetHeight)) {
                    this.triggerAction();
                }
            }
        });

        this.addEventListener('pointercancel', (e) => {
            this.classList.remove('active');
            if (this.releasePointerCapture && e.pointerId != null) {
                try {
                    this.releasePointerCapture(e.pointerId);
                } catch (_) {}
            }
        });

        // Fallback for click if pointerup wasn't triggered
        this.addEventListener('click', (e) => {
            if (this.hasAttribute('disabled')) return;
            // Prevent double triggers if pointerup already handled it
            if (e.detail === 0) { // Keyboard triggered click
                this.triggerAction();
            }
        });

        // Keyboard handling
        this.addEventListener('keydown', (e) => {
            if (this.hasAttribute('disabled')) return;
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.classList.add('active');
            }
        });

        this.addEventListener('keyup', (e) => {
            if (this.hasAttribute('disabled')) return;
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (this.classList.contains('active')) {
                    this.classList.remove('active');
                    this.triggerAction();
                }
            }
        });
    }
}

if (typeof window !== 'undefined') {
    window.ActionButton = ActionButton;
    if (typeof customElements !== 'undefined' && !customElements.get('action-button')) {
        customElements.define('action-button', ActionButton);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ActionButton };
}
