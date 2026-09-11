class NavProgressBar {
    constructor(app, parent) {
        this.app = app;
        this.parent = parent;
        this.progress = 0;
        this.initComponent();
    }

    initComponent() {
        this.progressBar = (typeof this.document !== 'undefined' ? this.document : document).createElement('div');
        this.progressBar.id = 'progress-slider';
        this.progressBar.setAttribute('progress', '0.000%');
        this.parent.appendChild(this.progressBar);

        document.body.addEventListener('ReadingPanelRenderOver', e => {
            // { progress: number, lines: Array<string>, lineIndexs: Array<number>, zeroIndex: number, startCharOffset: number, totalLength: number }
            this.progress = e.detail && typeof e.detail.progress === 'number' ? e.detail.progress : 0;
            this.render();
        });
    }

    render() {
        const prog = Math.max(0, Math.min(1, this.progress || 0));
        const pct = (prog * 100.0).toFixed(3) + '%';
        this.progressBar.setAttribute('progress', pct);

        const isRight2Left = this.app && this.app.currentWritingMode === 'vertical';
        const direction = isRight2Left ? 'to left' : 'to right';

        this.progressBar.style.background = `linear-gradient(${direction}, var(--color-primary, #667eea) 0%, var(--color-primary, #667eea) ${pct}, var(--color-border, #e2e8f0) ${pct}, var(--color-border, #e2e8f0) 100%)`;
    }
}

window.NavProgressBar = NavProgressBar;
