class ListSelector extends HTMLElement {

    static DEFAULT_STYLE = `
    @scope {
        :scope {
            display: block;
            position: relative;
            width: 100%;
            user-select: none;
            font-size: 0.95rem;
            line-height: 2.5;
        }
        .list-selector-trigger {
            display: flex;
            align-items: center;
            justify-content: space-between;
            width: 100%;
            padding: 0.55rem 0.85rem;
            background-color: var(--color-surface, #ffffff);
            border: 1px solid var(--color-border, #e2e8f0);
            border-radius: var(--radius-md, 8px);
            color: var(--color-text, #2d3748);
            cursor: pointer;
            box-sizing: border-box;
            transition: border-color 0.2s, box-shadow 0.2s, background-color 0.2s;
        }
        .list-selector-trigger:focus-visible,
        list-selector.open .list-selector-trigger {
            border-color: var(--color-primary, #667eea);
            box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.25);
            outline: none;
        }
        .list-selector-label {
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            text-align: left;
            line-height: 1.5;
        }
        .list-selector-arrow {
            flex-shrink: 0;
            margin-left: 0.5rem;
            color: var(--color-text-muted, #718096);
            transition: transform 0.2s ease;
        }
        list-selector.open .list-selector-arrow {
            transform: rotate(180deg);
        }
        .list-selector-dropdown {
            position: absolute;
            top: calc(100% + 4px);
            left: 0;
            width: 100%;
            max-height: 220px;
            overflow-y: auto;
            background-color: var(--color-surface, #ffffff);
            border: 1px solid var(--color-border, #e2e8f0);
            border-radius: var(--radius-md, 8px);
            box-shadow: var(--shadow-md, 0 4px 12px rgba(0, 0, 0, 0.2));
            z-index: 1000;
            box-sizing: border-box;
            padding: 0.25rem 0;
        }
        .list-selector-dropdown.hidden {
            display: none;
        }
        .list-selector-option {
            display: flex;
            align-items: center;
            padding: 0.55rem 0.85rem;
            color: var(--color-text, #2d3748);
            cursor: pointer;
            transition: background-color 0.15s, color 0.15s;
        }
        .list-selector-option:hover,
        .list-selector-option.highlighted {
            background-color: rgba(102, 126, 234, 0.12);
            color: var(--color-primary, #667eea);
        }
        .list-selector-option.selected {
            background-color: var(--color-primary, #667eea);
            color: #ffffff;
            font-weight: 600;
        }
        list-selector[disabled] .list-selector-trigger {
            opacity: 0.5;
            cursor: not-allowed;
        }
    }
    `;

    static get observedAttributes() {
        return ['value', 'field', 'disabled'];
    }

    constructor(options = null) {
        super();
        this._value = '';
        this._options = {};
        this._isOpen = false;
        this._boundClickOutside = this.handleClickOutside.bind(this);
        this.initComponent(options);
    }

    get value() {
        return this._value;
    }

    set value(val) {
        this.setValue(val, false);
    }

    get options() {
        return this._options;
    }

    set options(opts) {
        this.setOptions(opts);
    }

    attributeChangedCallback(name, oldVal, newVal) {
        if (oldVal === newVal) return;
        if (name === 'value') {
            this.setValue(newVal, false);
        }
    }

    initComponent(option = null) {
        const rawContent = (option ?? this.textContent).trim();
        this.innerHTML = '';
        const defaultStyle = document.createElement('STYLE');
        defaultStyle.innerHTML = ListSelector.DEFAULT_STYLE;
        this.appendChild(defaultStyle);

        // 1. Trigger
        this.trigger = document.createElement('div');
        this.trigger.className = 'list-selector-trigger';
        this.trigger.tabIndex = 0;
        this.trigger.setAttribute('role', 'combobox');
        this.trigger.setAttribute('aria-expanded', 'false');

        this.labelSpan = document.createElement('span');
        this.labelSpan.className = 'list-selector-label';

        const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        arrow.setAttribute('class', 'list-selector-arrow');
        arrow.setAttribute('width', '16');
        arrow.setAttribute('height', '16');
        arrow.setAttribute('viewBox', '0 0 24 24');
        arrow.setAttribute('fill', 'none');
        arrow.setAttribute('stroke', 'currentColor');
        arrow.setAttribute('stroke-width', '2');
        arrow.setAttribute('stroke-linecap', 'round');
        arrow.setAttribute('stroke-linejoin', 'round');
        arrow.innerHTML = '<polyline points="6 9 12 15 18 9"></polyline>';

        this.trigger.appendChild(this.labelSpan);
        this.trigger.appendChild(arrow);
        this.appendChild(this.trigger);

        // 2. Dropdown Menu
        this.dropdown = document.createElement('div');
        this.dropdown.className = 'list-selector-dropdown hidden';
        this.dropdown.setAttribute('role', 'listbox');
        this.appendChild(this.dropdown);

        // 3. Parse options from inner JSON if present
        if (rawContent) {
            try {
                const parsed = JSON.parse(rawContent);
                this.setOptions(parsed);
            } catch (err) {
                console.error('Failed to parse list-selector options JSON:', err);
            }
        }

        this.bindEvents();
    }

    setOptions(optionsMap) {
        this._options = optionsMap || {};
        this.dropdown.innerHTML = '';

        for (const [val, label] of Object.entries(this._options)) {
            const optEl = document.createElement('div');
            optEl.className = 'list-selector-option';
            optEl.dataset.value = val;
            optEl.setAttribute('role', 'option');

            const textSpan = document.createElement('span');
            textSpan.className = 'list-selector-option-text';

            if (typeof label === 'string') {
                if (label.startsWith('$')) {
                    textSpan.setAttribute('data-i18n', label.substring(1));
                } else if (label.startsWith('i18n:')) {
                    textSpan.setAttribute('data-i18n', label.replace('i18n:', ''));
                } else {
                    textSpan.textContent = label;
                }
            } else {
                textSpan.textContent = String(label);
            }

            optEl.appendChild(textSpan);
            this.dropdown.appendChild(optEl);
        }

        // Re-apply current value visuals
        this.updateVisualSelection();
    }

    setValue(val, fireChange = false) {
        val = val != null ? String(val) : '';
        const changed = this._value !== val;
        this._value = val;

        this.updateVisualSelection();

        if (fireChange) {
            this.dispatchEvent(new Event('change', { bubbles: true }));
            this.dispatchEvent(new CustomEvent('input', {
                bubbles: true,
                detail: { value: this._value }
            }));
            this.dispatchEvent(new CustomEvent('settingUpdated', {
                bubbles: true,
                detail: {
                    field: this.getAttribute('field'),
                    value: this._value
                }
            }));
        }

        return changed;
    }

    updateVisualSelection() {
        if (!this.dropdown || !this.labelSpan) return;

        let selectedOptEl = null;
        const options = this.dropdown.querySelectorAll('.list-selector-option');

        options.forEach(opt => {
            if (opt.dataset.value === this._value) {
                opt.classList.add('selected');
                selectedOptEl = opt;
            } else {
                opt.classList.remove('selected');
            }
        });

        // If no match found and we have options, fallback to first option
        if (!selectedOptEl && options.length > 0 && !this._value) {
            this._value = options[0].dataset.value;
            options[0].classList.add('selected');
            selectedOptEl = options[0];
        }

        // Update trigger label
        if (selectedOptEl) {
            const span = selectedOptEl.querySelector('.list-selector-option-text');
            if (span) {
                const i18nKey = span.getAttribute('data-i18n');
                if (i18nKey) {
                    this.labelSpan.setAttribute('data-i18n', i18nKey);
                    this.labelSpan.textContent = '';
                } else {
                    this.labelSpan.removeAttribute('data-i18n');
                    this.labelSpan.textContent = span.textContent;
                }
            } else {
                this.labelSpan.textContent = selectedOptEl.textContent;
            }
        } else {
            this.labelSpan.removeAttribute('data-i18n');
            this.labelSpan.textContent = this._value || '';
        }

        // If app i18n instance is available, update DOM text if not using pure CSS pseudo elements
        if (window._app && window._app.i18n && typeof window._app.i18n.updateDOM === 'function') {
            window._app.i18n.updateDOM(this.labelSpan);
        }
    }

    openDropdown() {
        if (this.hasAttribute('disabled') || this._isOpen) return;

        // Close any other open list-selectors
        document.querySelectorAll('list-selector.open').forEach(el => {
            if (el !== this && typeof el.closeDropdown === 'function') {
                el.closeDropdown();
            }
        });

        this._isOpen = true;
        this.classList.add('open');
        this.dropdown.classList.remove('hidden');
        this.trigger.setAttribute('aria-expanded', 'true');

        // Scroll selected option into view
        const selected = this.dropdown.querySelector('.list-selector-option.selected');
        if (selected) {
            selected.scrollIntoView({ block: 'nearest' });
        }

        document.addEventListener('pointerdown', this._boundClickOutside);
    }

    closeDropdown() {
        if (!this._isOpen) return;
        this._isOpen = false;
        this.classList.remove('open');
        this.dropdown.classList.add('hidden');
        this.trigger.setAttribute('aria-expanded', 'false');

        document.removeEventListener('pointerdown', this._boundClickOutside);
    }

    toggleDropdown() {
        if (this._isOpen) {
            this.closeDropdown();
        } else {
            this.openDropdown();
        }
    }

    handleClickOutside(e) {
        if (!this.contains(e.target)) {
            this.closeDropdown();
        }
    }

    bindEvents() {
        // Pointer down / click on trigger
        this.trigger.addEventListener('pointerdown', (e) => {
            if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
            e.preventDefault();
            this.toggleDropdown();
        });

        // Option selection
        this.dropdown.addEventListener('pointerdown', (e) => {
            const opt = e.target.closest('.list-selector-option');
            if (!opt) return;
            e.preventDefault();
            e.stopPropagation();

            const newVal = opt.dataset.value;
            this.setValue(newVal, true);
            this.closeDropdown();
            this.trigger.focus();
        });

        // Keyboard navigation
        this.trigger.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                if (!this._isOpen) {
                    this.openDropdown();
                    return;
                }
            }

            if (!this._isOpen) return;

            const options = Array.from(this.dropdown.querySelectorAll('.list-selector-option'));
            if (options.length === 0) return;

            let currentIndex = options.findIndex(o => o.classList.contains('selected') || o.classList.contains('highlighted'));

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                const nextIndex = (currentIndex + 1) % options.length;
                this.highlightOption(options, nextIndex);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                const prevIndex = (currentIndex - 1 + options.length) % options.length;
                this.highlightOption(options, prevIndex);
            } else if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                const highlighted = this.dropdown.querySelector('.list-selector-option.highlighted') ||
                                    this.dropdown.querySelector('.list-selector-option.selected');
                if (highlighted) {
                    this.setValue(highlighted.dataset.value, true);
                }
                this.closeDropdown();
            } else if (e.key === 'Escape' || e.key === 'Tab') {
                this.closeDropdown();
            }
        });
    }

    highlightOption(options, index) {
        options.forEach((opt, idx) => {
            if (idx === index) {
                opt.classList.add('highlighted');
                opt.scrollIntoView({ block: 'nearest' });
            } else {
                opt.classList.remove('highlighted');
            }
        });
    }

    disconnectedCallback() {
        document.removeEventListener('pointerdown', this._boundClickOutside);
    }
}

window.ListSelector = ListSelector;
customElements.define('list-selector', ListSelector);
