class ToggleButton extends ActionButton {

    initComponent() {
        super.initComponent();
        this.classList.add('toggle-button');
        const input = document.createElement('INPUT');
        this.switching = input;
        input.type = 'radio';
        input.name = this.getAttribute('name');
        input.checked = this.hasAttribute('checked');
        this.append(input);
    }

}

window.ToggleButton = ToggleButton;
customElements.define('toggle-button', ToggleButton);