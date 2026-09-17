class ActionButton extends HTMLElement {
    static get observedAttributes() {
        return ['action', 'disabled', 'variant'];
    }

    constructor() {
        super();
        this.initStyles();
        this.initComponent();
    }

    initStyles() {
        if (typeof document !== 'undefined' && !document.getElementById('action-button-styles')) {
            const style = document.createElement('style');
            style.id = 'action-button-styles';
            style.textContent = `
                action-button {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    box-sizing: border-box;
                    cursor: pointer;
                    user-select: none;
                    -webkit-user-select: none;
                    touch-action: manipulation;
                    font-size: 0.95rem;
                    font-weight: 500;
                    padding: 0.6rem 1rem;
                    border-radius: var(--radius-md, 8px);
                    background-color: var(--color-surface, #ffffff);
                    color: var(--color-text, #2d3748);
                    border: 1px solid var(--color-border, #e2e8f0);
                    transition: background-color 0.15s, border-color 0.15s, transform 0.05s, box-shadow 0.15s;
                    outline: none;
                    text-align: center;
                    width: 100%;
                }
                action-button:hover:not([disabled]) {
                    background-color: rgba(102, 126, 234, 0.08);
                    border-color: var(--color-primary, #667eea);
                }
                action-button:active:not([disabled]),
                action-button.active:not([disabled]) {
                    transform: scale(0.98);
                    background-color: rgba(102, 126, 234, 0.15);
                }
                action-button:focus-visible {
                    border-color: var(--color-primary, #667eea);
                    box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.25);
                }
                action-button[disabled] {
                    opacity: 0.5;
                    cursor: not-allowed;
                    pointer-events: none;
                }
                action-button[variant="primary"],
                action-button.primary {
                    background-color: var(--color-primary, #667eea);
                    color: #ffffff;
                    border-color: var(--color-primary, #667eea);
                }
                action-button[variant="primary"]:hover:not([disabled]),
                action-button.primary:hover:not([disabled]) {
                    background-color: var(--color-primary-dark, #5a67d8);
                }
                action-button[variant="danger"],
                action-button.danger,
                action-button[danger] {
                    background-color: var(--color-danger, #ef4444);
                    color: #ffffff;
                    border-color: var(--color-danger, #ef4444);
                }
                action-button[variant="danger"]:hover:not([disabled]),
                action-button.danger:hover:not([disabled]),
                action-button[danger]:hover:not([disabled]) {
                    background-color: #dc2626;
                }
            `;
            (document.head || document.documentElement).appendChild(style);
        }
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
        this.dispatchEvent(new CustomEvent('ActionPerformed', {
            bubbles: true,
            composed: true,
            detail: detail
        }));
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
