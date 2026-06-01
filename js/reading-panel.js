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
            } else if (e.detail && e.detail.action === 'prevPage') {
                this.prevPage();
            } else if (e.detail && e.detail.action === 'requestReadingOver') {
                this.dispatchReadingOver();
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
            this.app.currentFontFamily,
            this.app.margins
        );

        // Notify app of scroll for UI updates (progress bar, TTS check)
        if (this.app.onScroll) {
            this.app.onScroll(this.scrollOffset, this.maxScroll);
        }

        if (document.body.classList.contains('settings-interacting')) {
            this.drawMarginOverlays(rect, dpr);
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

    drawMarginOverlays(rect, dpr) {
        const ctx = this.ctx;
        ctx.save();
        // Reset transform first to avoid double-scaling if engine left it scaled
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);
        ctx.fillStyle = 'rgba(255, 204, 0, 0.4)';
        
        const m = this.app.margins || { top: 0, bottom: 0, left: 0, right: 0 };
        const w = rect.width;
        const h = rect.height;

        ctx.fillRect(0, 0, w, m.top);
        ctx.fillRect(0, h - m.bottom, w, m.bottom);
        ctx.fillRect(0, m.top, m.left, h - m.top - m.bottom);
        ctx.fillRect(w - m.right, m.top, m.right, h - m.top - m.bottom);

        ctx.restore();
    }

    dispatchReadingOver() {
        if (!this.drawOps || this.drawOps.length === 0) return;
        const { vMin, vMax, cw, ch } = this.getVisibleRange();
        
        // Find visible characters for current page
        const visibleOps = this.drawOps.filter(o => {
            const coord = this.app.currentWritingMode === 'vertical' ? o.x : o.y;
            return this.app.currentWritingMode === 'vertical' ? (coord >= vMin && coord <= vMax) : (coord >= vMin && coord <= vMax);
        });

        // Find characters for NEXT page
        const margins = this.app.margins || { top: 0, bottom: 0, left: 0, right: 0 };
        const fontSize = this.app.currentFontSize || 18;
        const lineHeightRatio = this.app.currentLineHeight || 1.8;
        const gridStep = fontSize * lineHeightRatio;
        const padX = Math.max(4, fontSize * 0.1);
        const padY = Math.max(4, fontSize * 0.1);
        const viewSize = this.app.currentWritingMode === 'vertical' 
            ? (cw - margins.left - margins.right - padX * 2)
            : (ch - margins.top - margins.bottom - padY * 2);
        
        let maxLines = 1;
        if (viewSize >= fontSize) {
            maxLines = Math.floor((viewSize - fontSize) / gridStep) + 1;
        }
        const jump = maxLines * gridStep;
        
        let next_vMin, next_vMax;
        if (this.app.currentWritingMode === 'vertical') {
            next_vMin = -(this.scrollOffset + jump);
            next_vMax = cw - (this.scrollOffset + jump);
        } else {
            next_vMin = this.scrollOffset + jump;
            next_vMax = ch + (this.scrollOffset + jump);
        }

        const nextVisibleOps = this.drawOps.filter(o => {
            const coord = this.app.currentWritingMode === 'vertical' ? o.x : o.y;
            return this.app.currentWritingMode === 'vertical' ? (coord >= next_vMin && coord <= next_vMax) : (coord >= next_vMin && coord <= next_vMax);
        });

        let text = visibleOps.map(o => o.char).join('');
        let nextText = nextVisibleOps.map(o => o.char).join('');
        const prog = this.maxScroll > 0 ? this.scrollOffset / this.maxScroll : 0;
        
        document.body.dispatchEvent(new CustomEvent('ReadingOver', {
            detail: { 
                reading: text,
                nextReading: nextText,
                prog: prog
            }
        }));
    }

    nextPage() {
        const rect = this.canvas.getBoundingClientRect();
        this.executeAction('next', rect);
    }

    prevPage() {
        const rect = this.canvas.getBoundingClientRect();
        this.executeAction('prev', rect);
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

        const padX = Math.max(4, fontSize * 0.1);
        const padY = Math.max(4, fontSize * 0.1);
        const viewSize = this.app.currentWritingMode === 'vertical' 
            ? (rect.width - margins.left - margins.right - padX * 2)
            : (rect.height - margins.top - margins.bottom - padY * 2);
        
        let maxLines = 1;
        if (viewSize >= fontSize) {
            maxLines = Math.floor((viewSize - fontSize) / gridStep) + 1;
        }
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
