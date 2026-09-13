class NavProgressBar extends HTMLElement {
    constructor() {
        super();
        this.progress = 0;
        this.isDragging = false;
        this.initComponent();
    }

    get isRight2Left() {
        return window._app && window._app.currentWritingMode === 'vertical';
    }

    initComponent() {
        this.style.position = this.style.position || 'relative';
        this.style.touchAction = 'none';
        this.style.userSelect = 'none';
        this.style.cursor = 'pointer';

        this.cursor = document.createElement('nax-progressbar-cursor');
        // this.cursor.classList.add('nax-progressbar-cursor');
        this.appendChild(this.cursor);

        const style = document.createElement('STYLE');
        style.innerHTML = `
            nax-progressbar {
                display: block;
                position: relative;
                min-height: 15px;
                border: 2px solid var(--color-border);
            }

            nax-progressbar::before {
                content: attr(progress);
                display: block;
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translateX(-50%) translateY(-50%);
                color: var(--color-text-muted);
                font-size: 80%;
            }

            nax-progressbar-cursor {
                display: none;
                position: absolute;
                width: 0;
                height: 0;
                top: 50%;
            }

            nax-progressbar-cursor::after {
                content: "";
                display: block;
                width: 21px;
                height: 21px;
                border-radius: 50%;
                border: 3px double var(--color-border);
                background: white;
                transform: translateX(-50%) translateY(-50%);
                box-sizing: border-box;
            }
        `;
        this.appendChild(style);

        // 監聽閱讀面板渲染進度更新（拖曳時不被外部覆蓋）
        document.body.addEventListener('ReadingPanelRenderOver', e => {
            if (this.isDragging) return;
            this.progress = e.detail && typeof e.detail.progress === 'number' ? e.detail.progress : 0;
            this.cursor.style.display = 'block';
            this.render();
        });

        // 拖曳 (Drag) 與 點擊 (Click) 事件處理 (使用 Pointer Events 支援滑鼠與觸控)
        this.addEventListener('pointerdown', (e) => {
            if (e.button !== undefined && e.button !== 0) return;
            this.isDragging = true;
            try {
                this.setPointerCapture(e.pointerId);
            } catch (err) {
                // Ignore pointer capture error
            }
            this.handlePointerProgress(e, false);
        });

        this.addEventListener('pointermove', (e) => {
            if (!this.isDragging) return;
            this.handlePointerProgress(e, false);
        });

        const onPointerUp = (e) => {
            if (!this.isDragging) return;
            this.isDragging = false;
            try {
                if (this.hasPointerCapture(e.pointerId)) {
                    this.releasePointerCapture(e.pointerId);
                }
            } catch (err) {
                // Ignore
            }
            this.handlePointerProgress(e, true);
        };

        this.addEventListener('pointerup', onPointerUp);
        this.addEventListener('pointercancel', onPointerUp);
    }

    getProgressFromEvent(e) {
        const rect = this.getBoundingClientRect();
        if (rect.width <= 0) return 0;

        let x = e.clientX - rect.left;
        x = Math.max(0, Math.min(rect.width, x));

        const isRTL = this.isRight2Left;
        // 若為直排 / RTL (由右至左)，進度從右側開始計算；若為橫排 / LTR，從左側開始計算
        const progress = isRTL ? (rect.width - x) / rect.width : x / rect.width;
        return Math.max(0, Math.min(1, progress));
    }

    handlePointerProgress(e, isCommit = false) {
        const progress = this.getProgressFromEvent(e);
        // this.render();
        this.updateCursorPosition(progress);
        this.dispatchProgress(progress, isCommit);
    }

    updateCursorPosition(prog) {
        const pct = (prog * 100.0).toFixed(3) + '%';
        // 移動 cursor 位置 (依據 LTR / RTL 方向設置)
        if (this.cursor) {
            if (this.isRight2Left) {
                this.cursor.style.left = '';
                this.cursor.style.right = pct;
            } else {
                this.cursor.style.right = '';
                this.cursor.style.left = pct;
            }
        }
    }

    dispatchProgress(progress, isCommit = false) {
        // 觸發 ReadingOperation 事件通知 ReadingPanel 更新進度
        document.body.dispatchEvent(new CustomEvent('ReadingOperation', {
            detail: {
                action: 'setProgress',
                params: [progress]
            }
        }));

        // 觸發自定義 DOM 事件
        this.dispatchEvent(new CustomEvent('input', {
            detail: { progress, isCommit },
            bubbles: true
        }));

        if (isCommit) {
            this.dispatchEvent(new CustomEvent('change', {
                detail: { progress },
                bubbles: true
            }));
        }
    }

    render() {
        const prog = Math.max(0, Math.min(1, this.progress || 0));
        const pct = (prog * 100.0).toFixed(3) + '%';
        this.setAttribute('progress', pct);

        const isRTL = this.isRight2Left;
        const direction = isRTL ? 'to left' : 'to right';

        this.style.background = `linear-gradient(${direction}, var(--color-primary, #667eea) 0%, var(--color-primary, #667eea) ${pct}, var(--color-border, #e2e8f0) ${pct}, var(--color-border, #e2e8f0) 100%)`;

    }
}

window.NavProgressBar = NavProgressBar;
customElements.define('nax-progressbar', NavProgressBar);