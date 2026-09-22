class NavToast extends Component {
    constructor() {
        super();
        this.toastTimeout = null;
        this.toastHidePopoverTimeout = null;
        this.initComponent();
    }

    initComponent() {
        this.setAttribute('popover', 'manual');
        this.classList.add('toast');

        // 監聽全域 showInToast 事件
        document.body.addEventListener('showInToast', (e) => {
            if (!e.detail) return;
            const message = e.detail.message;
            const duration = typeof e.detail.duration === 'number' ? e.detail.duration : 3000;

            if (e.detail.action === 'hide' || message === '') {
                this.hide();
            } else if (message != null) {
                this.show(message, duration);
            }
        });
    }

    show(msg, duration = 3000) {
        this.textContent = String(msg ?? '');

        if (this.toastTimeout) {
            clearTimeout(this.toastTimeout);
            this.toastTimeout = null;
        }
        if (this.toastHidePopoverTimeout) {
            clearTimeout(this.toastHidePopoverTimeout);
            this.toastHidePopoverTimeout = null;
        }

        // 透過 popover API 提升至 Top Layer (防止被 fixed 元素或 backdrop-filter 毛玻璃遮擋)
        if (typeof this.showPopover === 'function') {
            try {
                if (!this.matches(':popover-open')) {
                    this.showPopover();
                }
            } catch (_) {}
        }

        const applyShow = () => {
            this.classList.add('show');
            this.setAttribute('show', '');
        };
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(applyShow);
        } else {
            applyShow();
        }

        if (duration > 0) {
            this.toastTimeout = setTimeout(() => {
                this.hide();
            }, duration);
        }
    }

    hide() {
        if (this.toastTimeout) {
            clearTimeout(this.toastTimeout);
            this.toastTimeout = null;
        }
        if (this.toastHidePopoverTimeout) {
            clearTimeout(this.toastHidePopoverTimeout);
            this.toastHidePopoverTimeout = null;
        }

        this.classList.remove('show');
        this.removeAttribute('show');

        // 等待 350ms CSS 動畫結束後退出 Top Layer
        if (typeof this.hidePopover === 'function') {
            this.toastHidePopoverTimeout = setTimeout(() => {
                try {
                    if (this.matches(':popover-open')) {
                        this.hidePopover();
                    }
                } catch (_) {}
            }, 350);
        }
    }
}

if (typeof window !== 'undefined') {
    window.NavToast = NavToast;
    if (typeof customElements !== 'undefined' && !customElements.get('nav-toast')) {
        customElements.define('nav-toast', NavToast);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { NavToast };
}
