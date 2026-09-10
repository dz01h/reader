class ReadingPanel {
    constructor(app, parent) {
        this.parent = parent;
        this.app = app;

        // State
        this.scrollOffset = 0;
        this.maxScroll = 0;
        this.doc = null;

        // Inertia / Drag State
        this.isDragging = false;
        this.lastDragCoord = 0;
        this.velocity = 0;
        this.lastTime = 0;
        this.inertiaFrameId = null;
        this.readingOverTimeout = null;

        this.initComponent();
    }

    initComponent() {
        const canvas = this.canvas = document.createElement('canvas');
        canvas.classList.add('reader-canvas');
        (new ResizeObserver(this.resize.bind(this))).observe(canvas);
        this.parent.appendChild(canvas);
        this.ctx = this.canvas.getContext('2d');

        this.engine = null;

        // Mouse Events
        canvas.addEventListener('mousedown', (e) => this.onDragStart(e));
        window.addEventListener('mousemove', (e) => this.onDragMove(e));
        window.addEventListener('mouseup', () => this.onDragEnd());

        // Touch Events
        canvas.addEventListener('touchstart', (e) => this.onDragStart(e), { passive: false });
        canvas.addEventListener('touchmove', (e) => this.onDragMove(e), { passive: false });
        canvas.addEventListener('touchend', () => this.onDragEnd());

        // Quadrant Click Navigation
        canvas.addEventListener('click', (e) => this.handleClick(e));

        document.body.addEventListener('ReadingOperation', (e) => {
            e.detail && this[e.detail.action] && this[e.detail.action]();
        });

    }

    read(doc) {
        console.log("ReadingPanel: set document");
        this.doc = doc;
        this.resize();
    }

    reset() {
        this.scrollOffset = 0;
        this.maxScroll = 0;
        this.doc = null;
        if (this.inertiaFrameId) {
            cancelAnimationFrame(this.inertiaFrameId);
            this.inertiaFrameId = null;
        }
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    resize() {
        const rect = this.canvas.getBoundingClientRect();

        if(!this.engine) this.engine = new window.TextRenderEngine({
            width: rect.width,
            height: rect.height,
            fontSize: this.app.currentFontSize ?? null,
            fontFamily: this.app.currentFontFamily ?? null,
            lineHeightRatio: this.app.currentLineHeight ?? null,
            margins: this.app.margins ?? null,
            writingMode: this.app.currentWritingMode ?? null
        });

        this.engine.updateSize(this.canvas);

        if(this.doc) {
            this.doc.format(this.engine);
            this.maxScroll = this.engine.getMaxScroll(this.doc);
        }

        this.render();
    }

    setLayout(drawOps, maxScroll, targetScroll) {
        this.drawOps = drawOps;
        this.maxScroll = maxScroll;
        this.scrollOffset = Math.max(0, Math.min(targetScroll, maxScroll));
        this.render();
    }

    setScrollOffset(val, dosnap = false) {
        if (!this.doc) return;
        
        if (dosnap) {
            const fontSize = this.app.currentFontSize || 18;
            const lineHeightRatio = this.app.currentLineHeight || 1.8;
            const gridStep = fontSize * lineHeightRatio;
            val = Math.round(val / gridStep) * gridStep;
        }

        this.scrollOffset = Math.max(0, Math.min(val, this.maxScroll));
        this.render(dosnap);
    }

    render(stable = false) {
        if (!this.doc) return;

        this.engine.render(
            this.ctx,
            this.doc,
            this.scrollOffset
        );

        if (document.body.classList.contains('settings-interacting')) {
            this.drawMarginOverlays(rect, dpr);
        }

        // Fire ReadingOver event with visible text ONLY when stable (debounced)
        if(stable) this.dispatchReadingOver();
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
        if (!this.doc) return;
        return;
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

    onDragStart(e) {
        let p = e;
        if (!this.doc) return;
        if (e.touches && (p = e.touches[0]) && e.touches.length > 1) return;
        this.isDragging = true;
        this.velocity = 0;
        this.lastDragCoord = this.app.currentWritingMode === 'vertical' ? p.screenX : p.screenY;
        this.lastTime = performance.now();
    }

    onDragMove(e) {
        let p = e;
        if (!this.isDragging || !this.doc) return;
        if (e.touches && (p = e.touches[0]) && e.touches.length > 1) return; // Ignore multi-touch
        e.preventDefault();
        const currentCoord = this.app.currentWritingMode === 'vertical' ? p.screenX : p.screenY;
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
            this.setScrollOffset(this.scrollOffset, true);
        }
    }

    startInertialScroll(totalDisplacement, friction = 0.95) {
        if (this.inertiaFrameId) cancelAnimationFrame(this.inertiaFrameId);
        
        let currentV = totalDisplacement * (1 - friction);
        
        const loop = () => {
            if (this.isDragging || Math.abs(currentV) < 0.5) {
                this.inertiaFrameId = null;
                this.setScrollOffset(this.scrollOffset, !this.isDragging);
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
        if (!this.doc) return;
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
        
        // 保留 1 行作為閱讀銜接
        const linesToJump = maxLines > 1 ? maxLines - 1 : 1;
        const jump = linesToJump * gridStep;

        switch (action) {
            case 'prev':
                this.setScrollOffset(this.scrollOffset - jump, true);
                break;
            case 'next':
                this.setScrollOffset(this.scrollOffset + jump, true);
                break;
        }
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
