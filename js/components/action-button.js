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
        this._lastActionTrigger = Date.now();
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
        });

        this.addEventListener('pointerup', (e) => {
            if (this.hasAttribute('disabled')) return;
            const wasActive = this.classList.contains('active');
            this.classList.remove('active');

            if (wasActive) {
                if (typeof this.getBoundingClientRect === 'function') {
                    const rect = this.getBoundingClientRect();
                    if (
                        e.clientX >= rect.left &&
                        e.clientX <= rect.right &&
                        e.clientY >= rect.top &&
                        e.clientY <= rect.bottom
                    ) {
                        this._preventClickUntil = Date.now() + 600;
                        this.triggerAction();
                        return;
                    }
                }
                // If bounding rect is 0 (e.g. in headless / synthetic test), fallback trigger
                if (typeof window !== 'undefined' && (!this.offsetWidth && !this.offsetHeight)) {
                    this._preventClickUntil = Date.now() + 600;
                    this.triggerAction();
                }
            }
        });

        this.addEventListener('pointercancel', (e) => {
            this.classList.remove('active');
        });

        // Fallback for click if pointerup wasn't triggered or on touch / keyboard
        this.addEventListener('click', (e) => {
            if (this._preventClickUntil && Date.now() < this._preventClickUntil) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            if (this.hasAttribute('disabled')) return;
            // Prevent double triggers if pointerup already handled it within 500ms
            if (this._lastActionTrigger && (Date.now() - this._lastActionTrigger < 500)) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            this.triggerAction();
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
