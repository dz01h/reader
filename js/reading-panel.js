class ReadingPanel {
    constructor(app, canvas) {
        this.app = app;
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.engine = new window.ZenEngine(this.canvas, this.ctx);

        // State
        this.scrollOffset = 0;
        this.maxScroll = 0;
        this.drawOps = [];

        // Inertia / Drag State
        this.isDragging = false;
        this.lastDragCoord = 0;
        this.velocity = 0;
        this.lastTime = 0;
        this.inertiaFrameId = null;
        this.readingOverTimeout = null;

        this.bindEvents();
        this.initEventListeners();
    }

    initEventListeners() {
        document.body.addEventListener('ReadingOperation', (e) => {
            if (e.detail && e.detail.action === 'nextPage') {
                this.nextPage();
            }
        });
    }

    reset() {
        this.scrollOffset = 0;
        this.maxScroll = 0;
        this.drawOps = [];
        if (this.inertiaFrameId) {
            cancelAnimationFrame(this.inertiaFrameId);
            this.inertiaFrameId = null;
        }
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    resize() {
        const rect = this.canvas.getBoundingClientRect();
        const dpr = Math.max(window.devicePixelRatio || 1, 2);
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.render();
    }

    setLayout(drawOps, maxScroll, targetScroll) {
        this.drawOps = drawOps;
        this.maxScroll = maxScroll;
        this.scrollOffset = Math.max(0, Math.min(targetScroll, maxScroll));
        this.render();
    }

    setScrollOffset(val) {
        this.scrollOffset = val;
        this.clampScroll();
        this.render();
    }

    clampScroll() {
        if (this.scrollOffset < 0) this.scrollOffset = 0;
        if (this.scrollOffset > this.maxScroll) this.scrollOffset = this.maxScroll;
    }

    render() {
        if (!this.drawOps || this.drawOps.length === 0) return;
        this.clampScroll();

        const rect = this.canvas.getBoundingClientRect();
        // Handle Retina/High-DPI
        const dpr = Math.max(window.devicePixelRatio || 1, 2);
        if (this.canvas.width !== rect.width * dpr || this.canvas.height !== rect.height * dpr) {
            this.canvas.width = rect.width * dpr;
            this.canvas.height = rect.height * dpr;
        }

        this.engine.drawOperations(
            this.drawOps,
            this.scrollOffset,
            this.app.currentFontSize,
            this.app.currentWritingMode,
            rect.width,
            rect.height,
            this.app.currentFontFamily
        );

        // Notify app of scroll for UI updates (progress bar, TTS check)
        if (this.app.onScroll) {
            this.app.onScroll(this.scrollOffset, this.maxScroll);
        }

        // Fire ReadingOver event with visible text ONLY when stable (debounced)
        if (!this.isDragging && !this.inertiaFrameId) {
            if (this.readingOverTimeout) clearTimeout(this.readingOverTimeout);
            this.readingOverTimeout = setTimeout(() => {
                this.dispatchReadingOver();
                this.readingOverTimeout = null;
            }, 200);
        }
    }

    dispatchReadingOver() {
        if (!this.drawOps || this.drawOps.length === 0) return;
        const { vMin, vMax } = this.getVisibleRange();
        
        // Find visible characters and group into paragraphs (roughly)
        const visibleOps = this.drawOps.filter(o => {
            const coord = this.app.currentWritingMode === 'vertical' ? o.x : o.y;
            return this.app.currentWritingMode === 'vertical' ? (coord >= vMin && coord <= vMax) : (coord >= vMin && coord <= vMax);
        });

        // Collect text. In vertical mode, they are right-to-left, top-to-bottom.
        // In horizontal mode, they are top-to-bottom, left-to-right.
        // The drawOps are already in reading order.
        let text = visibleOps.map(o => o.char).join('');
        const prog = this.maxScroll > 0 ? this.scrollOffset / this.maxScroll : 0;
        
        document.body.dispatchEvent(new CustomEvent('ReadingOver', {
            detail: { 
                reading: text,
                prog: prog
            }
        }));
    }

    nextPage() {
        const rect = this.canvas.getBoundingClientRect();
        this.executeAction('next', rect);
    }

    bindEvents() {
        const canvas = this.canvas;

        // Mouse Events
        canvas.addEventListener('mousedown', (e) => this.onDragStart(e));
        window.addEventListener('mousemove', (e) => this.onDragMove(e));
        window.addEventListener('mouseup', () => this.onDragEnd());

        // Touch Events
        canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) this.onDragStart(e.touches[0]);
        }, { passive: false });
        canvas.addEventListener('touchmove', (e) => {
            if (e.touches.length === 1) {
                e.preventDefault();
                this.onDragMove(e.touches[0]);
            }
        }, { passive: false });
        canvas.addEventListener('touchend', () => this.onDragEnd());

        // Quadrant Click Navigation
        canvas.addEventListener('click', (e) => this.handleClick(e));
    }

    onDragStart(e) {
        if (!this.drawOps || this.drawOps.length === 0) return;
        this.isDragging = true;
        this.lastDragCoord = this.app.currentWritingMode === 'vertical' ? e.screenX : e.screenY;
        this.lastTime = performance.now();
        this.velocity = 0;
        if (this.inertiaFrameId) {
            cancelAnimationFrame(this.inertiaFrameId);
            this.inertiaFrameId = null;
        }
    }

    onDragMove(e) {
        if (!this.isDragging || !this.drawOps || this.drawOps.length === 0) return;
        const currentCoord = this.app.currentWritingMode === 'vertical' ? e.screenX : e.screenY;
        const delta = this.app.currentWritingMode === 'vertical' ? (currentCoord - this.lastDragCoord) : (this.lastDragCoord - currentCoord);
        
        const now = performance.now();
        const dt = Math.max(1, now - this.lastTime);
        this.velocity = (delta / dt) * 16.67; 
        
        this.lastDragCoord = currentCoord;
        this.lastTime = now;
        
        this.scrollOffset += delta;
        this.render();
    }

    onDragEnd() {
        if (!this.isDragging) return;
        this.isDragging = false;
        
        if (Math.abs(this.velocity) > 1) {
            this.startInertialScroll(this.velocity * 15, 0.92);
        } else {
            this.setScrollOffset(this.snapToGrid(this.scrollOffset));
            this.app.saveProgress();
        }
    }

    startInertialScroll(totalDisplacement, friction = 0.95) {
        if (!this.drawOps || this.drawOps.length === 0) return;
        if (this.inertiaFrameId) {
            cancelAnimationFrame(this.inertiaFrameId);
            this.inertiaFrameId = null;
        }
        
        let currentV = totalDisplacement * (1 - friction);
        
        const loop = () => {
            if (Math.abs(currentV) < 0.5) {
                this.inertiaFrameId = null;
                this.setScrollOffset(this.snapToGrid(this.scrollOffset));
                this.app.saveProgress();
                return;
            }
            
            this.scrollOffset += currentV;
            this.render();
            currentV *= friction;
            
            if (this.scrollOffset < 0 || this.scrollOffset > this.maxScroll) {
                currentV *= 0.5;
                if (this.scrollOffset < 0) this.scrollOffset = 0;
                if (this.scrollOffset > this.maxScroll) this.scrollOffset = this.maxScroll;
            }
            
            this.inertiaFrameId = requestAnimationFrame(loop);
        };
        loop();
    }

    handleClick(e) {
        if (!this.drawOps || this.drawOps.length === 0) return;
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const isMiddleX = x > rect.width * 0.3 && x < rect.width * 0.7;
        const isMiddleY = y > rect.height * 0.3 && y < rect.height * 0.7;

        if (isMiddleX && isMiddleY) {
            this.app.toggleUI();
            return;
        }

        const hw = rect.width / 2;
        const hh = rect.height / 2;
        let action = 'none';

        if (x < hw && y < hh) action = this.app.quadTL;
        else if (x >= hw && y < hh) action = this.app.quadTR;
        else if (x < hw && y >= hh) action = this.app.quadBL;
        else action = this.app.quadBR;

        this.executeAction(action, rect);
    }

    executeAction(action, rect) {
        const margins = this.app.margins || { top: 0, bottom: 0, left: 0, right: 0 };
        const fontSize = this.app.currentFontSize || 18;
        const lineHeightRatio = this.app.currentLineHeight || 1.8;
        const gridStep = fontSize * lineHeightRatio;

        const viewSize = this.app.currentWritingMode === 'vertical' 
            ? (rect.width - margins.left - margins.right)
            : (rect.height - margins.top - margins.bottom);
        
        const maxLines = Math.max(1, Math.floor(viewSize / gridStep));
        const jump = maxLines * gridStep;

        switch (action) {
            case 'prev':
                this.setScrollOffset(this.snapToGrid(this.scrollOffset - jump));
                this.app.saveProgress();
                break;
            case 'next':
                this.setScrollOffset(this.snapToGrid(this.scrollOffset + jump));
                this.app.saveProgress();
                break;
        }
    }

    snapToGrid(offset) {
        const fontSize = this.app.currentFontSize || 18;
        const lineHeightRatio = this.app.currentLineHeight || 1.8;
        const gridStep = fontSize * lineHeightRatio;
        return Math.round(offset / gridStep) * gridStep;
    }
    
    getVisibleRange() {
        const rect = this.canvas.getBoundingClientRect();
        const cw = rect.width;
        const ch = rect.height;
        let vMin, vMax;
        if (this.app.currentWritingMode === 'vertical') {
            vMin = -this.scrollOffset;
            vMax = cw - this.scrollOffset;
        } else {
            vMin = this.scrollOffset;
            vMax = ch + this.scrollOffset;
        }
        return { vMin, vMax, cw, ch };
    }
}

window.ReadingPanel = ReadingPanel;
