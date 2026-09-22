class ToggleButton extends ActionButton {
    static get observedAttributes() {
        return [...(super.observedAttributes || []), 'value', 'checked', 'name'];
    }

    get value() {
        return this.getAttribute('value') ?? '';
    }

    set value(val) {
        if (val != null) {
            this.setAttribute('value', String(val));
            if (this.switching) {
                this.switching.value = String(val);
                this.switching.setAttribute('value', String(val));
            }
        } else {
            this.removeAttribute('value');
            if (this.switching) {
                this.switching.value = '';
                this.switching.removeAttribute('value');
            }
        }
    }

    attributeChangedCallback(name, oldVal, newVal) {
        super.attributeChangedCallback?.(name, oldVal, newVal);
        if (name === 'value' && this.switching && this.switching.value !== (newVal ?? '')) {
            this.switching.value = newVal ?? '';
            if (newVal != null) {
                this.switching.setAttribute('value', newVal);
            } else {
                this.switching.removeAttribute('value');
            }
        } else if (name === 'checked' && this.switching) {
            this.switching.checked = this.hasAttribute('checked');
        } else if (name === 'name' && this.switching) {
            this.switching.name = newVal ?? '';
        }
    }

    initComponent() {
        super.initComponent();
        this.classList.add('toggle-button');
        const input = document.createElement('INPUT');
        this.switching = input;
        input.type = 'radio';
        input.name = this.getAttribute('name') ?? '';
        input.checked = this.hasAttribute('checked');
        input.value = this.getAttribute('value') ?? '';
        if (this.hasAttribute('value')) {
            input.setAttribute('value', this.getAttribute('value'));
        }
        this.prepend(input);
    }

    triggerAction() {
        if (this.hasAttribute('disabled')) return;
        
        const checked = this.switching.checked;

        this.switching.checked = true;

        const action = this.getAttribute('action');
        if (!action) return;

        const detail = {
            action: action,
            value: this.switching.value ?? '',
            checked: checked
        };

        // Dispatch on the button itself (bubbles up)
        this.fireEvent('ActionPerformed', detail, true);
    }
}

window.ToggleButton = ToggleButton;
customElements.define('toggle-button', ToggleButton);