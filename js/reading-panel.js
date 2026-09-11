class ReadingPanel {
    constructor(app, parent) {
        this.parent = parent;
        this.app = app;

        // State
        this.doc = null;
        this.engine = null;
        this.scrollOffset = 0; // Drag displacement in CSS logical pixels relative to zeroIndex

        // Inertia / Drag State
        this.isDragging = false;
        this.lastDragCoord = 0;
        this.velocity = 0;
        this.lastTime = 0;
        this.inertiaFrameId = null;

        this.initComponent();
    }

    initComponent() {
        const canvas = this.canvas = document.createElement('canvas');
        canvas.classList.add('reader-canvas');
        (new ResizeObserver(this.resize.bind(this))).observe(canvas);
        this.parent.appendChild(canvas);
        this.ctx = this.canvas.getContext('2d');

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

        // ReadingOperation Event Listener (Next / Prev / Page Actions)
        document.body.addEventListener('ReadingOperation', (e) => {
            if (e.detail && e.detail.action && typeof this[e.detail.action] === 'function') {
                this[e.detail.action]();
            }
        });
    }

    read(doc) {
        this.doc = doc;
        this.scrollOffset = 0;
        if (this.inertiaFrameId) {
            cancelAnimationFrame(this.inertiaFrameId);
            this.inertiaFrameId = null;
        }
        this.resize();
    }

    reset() {
        this.scrollOffset = 0;
        this.doc = null;
        if (this.inertiaFrameId) {
            cancelAnimationFrame(this.inertiaFrameId);
            this.inertiaFrameId = null;
        }
        if (this.ctx && this.canvas) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
    }

    resize() {
        if (!this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        if (!this.engine) {
            this.engine = new window.TextRenderEngine({
                width: rect.width,
                height: rect.height,
                fontSize: this.app.currentFontSize ?? 18,
                fontFamily: this.app.currentFontFamily ?? 'sans-serif',
                lineHeightRatio: this.app.currentLineHeight ?? 1.8,
                margins: this.app.margins ?? { top: 30, bottom: 30, left: 30, right: 30 },
                writingMode: this.app.currentWritingMode ?? 'horizontal',
                wordSpacing: this.app.currentWordSpacing ?? 1
            });
        } else {
            this.engine.updateConfig({
                width: rect.width,
                height: rect.height,
                fontSize: this.app.currentFontSize,
                fontFamily: this.app.currentFontFamily,
                lineHeightRatio: this.app.currentLineHeight,
                margins: this.app.margins,
                writingMode: this.app.currentWritingMode,
                wordSpacing: this.app.currentWordSpacing
            });
        }

        this.engine.updateSize(this.canvas);
        this.render(true);
    }

    snapToGrid(val) {
        return this.engine ? this.engine.snap(val) : val;
    }

    get progress() {
        return this.doc ? this.doc.progress : 0;
    }

    setProgress(prog) {
        if (!this.doc) return;
        this.doc.setProgress(prog);
        this.scrollOffset = 0;
        this.render(true);
    }

    setScrollOffset(val, dosnap = false) {
        if (!this.doc || !this.engine) return;
        this.scrollOffset = dosnap ? this.engine.snap(val) : val;
        if (dosnap) {
            this.commitScroll();
        } else {
            this.render(false);
        }
    }

    render(stable = false) {
        if (!this.doc || !this.engine) return;

        this.engine.render(
            this.ctx,
            this.doc,
            this.scrollOffset,
            {
                showMargins: document.body.classList.contains('settings-interacting')
            }
        );

        // Fire ReadingOver event with visible text ONLY when stable (debounced / committed)
        if (stable) {
            this.dispatchReadingOver();
        }
    }

    dispatchReadingOver() {
        if (!this.doc || !this.engine) return;

        const renderData = this.engine.getRenderData(this.doc);
        if (!renderData || !renderData.lines || renderData.lines.length === 0) return;

        const linesPerPage = this.engine.linesPerPage;
        const zeroIdx = renderData.zeroIndex;
        const totalLines = renderData.lines.length;

        // Current page text: from zeroIndex to zeroIndex + linesPerPage - 1
        const curEndIdx = Math.min(totalLines - 1, zeroIdx + linesPerPage - 1);
        let reading = '';
        for (let i = zeroIdx; i <= curEndIdx; i++) {
            const line = renderData.lines[i];
            const lineText = typeof line === 'string' ? line : (line?.text ?? '');
            if (lineText) {
                reading += lineText + '\n';
            }
        }
        reading = reading.trim();

        // Next page text: from zeroIndex + linesPerPage to zeroIndex + 2 * linesPerPage - 1
        const nextStartIdx = zeroIdx + linesPerPage;
        const nextEndIdx = Math.min(totalLines - 1, nextStartIdx + linesPerPage - 1);
        let nextReading = '';
        for (let i = nextStartIdx; i <= nextEndIdx; i++) {
            const line = renderData.lines[i];
            const lineText = typeof line === 'string' ? line : (line?.text ?? '');
            if (lineText) {
                nextReading += lineText + '\n';
            }
        }
        nextReading = nextReading.trim();

        document.body.dispatchEvent(new CustomEvent('ReadingOver', {
            detail: {
                reading: reading,
                nextReading: nextReading,
                prog: this.doc.progress
            }
        }));
    }

    onDragStart(e) {
        if (!this.doc || !this.engine) return;
        if (e.touches && e.touches.length > 1) return;

        if (this.inertiaFrameId) {
            cancelAnimationFrame(this.inertiaFrameId);
            this.inertiaFrameId = null;
        }

        const p = e.touches ? e.touches[0] : e;
        this.isDragging = true;
        this.velocity = 0;
        this.lastDragCoord = this.engine.writingMode === 'vertical' ? p.screenX : p.screenY;
        this.lastTime = performance.now();
    }

    onDragMove(e) {
        if (!this.isDragging || !this.doc || !this.engine) return;
        if (e.touches && e.touches.length > 1) return; // Ignore multi-touch gestures

        if (e.cancelable) e.preventDefault();

        const p = e.touches ? e.touches[0] : e;
        const currentCoord = this.engine.writingMode === 'vertical' ? p.screenX : p.screenY;

        // Content strictly follows finger displacement
        const delta = currentCoord - this.lastDragCoord;

        const now = performance.now();
        const dt = Math.max(1, now - this.lastTime);
        this.velocity = (delta / dt) * 16.67;

        this.lastDragCoord = currentCoord;
        this.lastTime = now;

        // Boundary resistance damping
        const renderData = this.engine.getRenderData(this.doc);
        if (renderData) {
            const isVert = this.engine.writingMode === 'vertical';
            const forwardLines = renderData.lines.length - 1 - renderData.zeroIndex;
            const backwardLines = renderData.zeroIndex;
            const minScroll = isVert ? -backwardLines * this.engine.lineHeight : -forwardLines * this.engine.lineHeight;
            const maxScroll = isVert ? forwardLines * this.engine.lineHeight : backwardLines * this.engine.lineHeight;

            const nextOffset = this.scrollOffset + delta;

            if ((nextOffset < minScroll && this.doc.progress <= (isVert ? 0 : 1)) || (nextOffset > maxScroll && this.doc.progress >= (isVert ? 1 : 0))) {
                this.scrollOffset += delta * 0.3;
            } else {
                this.scrollOffset = nextOffset;
            }
        } else {
            this.scrollOffset += delta;
        }

        this.render(false);
    }

    onDragEnd() {
        if (!this.isDragging) return;
        this.isDragging = false;

        if (Math.abs(this.velocity) > 1.5) {
            this.startInertialScroll(this.velocity * 12, 0.92);
        } else {
            this.commitScroll();
        }
    }

    startInertialScroll(totalDisplacement, friction = 0.92) {
        if (this.inertiaFrameId) {
            cancelAnimationFrame(this.inertiaFrameId);
            this.inertiaFrameId = null;
        }

        let currentV = totalDisplacement * (1 - friction);

        const loop = () => {
            if (this.isDragging) {
                this.inertiaFrameId = null;
                return;
            }

            if (Math.abs(currentV) < 0.5) {
                this.inertiaFrameId = null;
                this.commitScroll();
                return;
            }

            this.scrollOffset += currentV;
            this.render(false);
            currentV *= friction;

            // Damping near window edges
            const renderData = this.engine ? this.engine.getRenderData(this.doc) : null;
            if (renderData) {
                const isVert = this.engine.writingMode === 'vertical';
                const forwardLines = renderData.lines.length - 1 - renderData.zeroIndex;
                const backwardLines = renderData.zeroIndex;
                const minScroll = isVert ? -backwardLines * this.engine.lineHeight : -forwardLines * this.engine.lineHeight;
                const maxScroll = isVert ? forwardLines * this.engine.lineHeight : backwardLines * this.engine.lineHeight;

                if (this.scrollOffset < minScroll || this.scrollOffset > maxScroll) {
                    currentV *= 0.5;
                    if (this.scrollOffset < minScroll && this.doc.progress <= (isVert ? 0 : 1)) {
                        this.scrollOffset = minScroll;
                    }
                    if (this.scrollOffset > maxScroll && this.doc.progress >= (isVert ? 1 : 0)) {
                        this.scrollOffset = maxScroll;
                    }
                }
            }

            this.inertiaFrameId = requestAnimationFrame(loop);
        };

        this.inertiaFrameId = requestAnimationFrame(loop);
    }

    /**
     * Calculate new reading progress at target line index within render data
     * Uses renderData.lineIndexs[targetIdx] and renderData.totalLength for exact character offset precision
     * @param {Object} renderData
     * @param {number} targetIdx
     * @returns {number} Progress ratio (0.0 ~ 1.0)
     */
    calculateProgressAtLine(renderData, targetIdx) {
        if (!renderData || !renderData.lines || renderData.lines.length === 0 || !this.doc || !this.doc.text) {
            return 0;
        }
        const totalLen = renderData.totalLength || this.doc.text.length;
        if (totalLen === 0) return 0;

        // 1. Direct lookup from lineIndexs (exact strpos)
        if (renderData.lineIndexs && typeof renderData.lineIndexs[targetIdx] === 'number') {
            const targetCharOffset = renderData.lineIndexs[targetIdx];
            return Math.max(0, Math.min(1, targetCharOffset / totalLen));
        }

        // 2. Lookup if targetLine is object with start offset
        const targetLine = renderData.lines[targetIdx];
        if (targetLine && typeof targetLine.start === 'number') {
            return Math.max(0, Math.min(1, targetLine.start / totalLen));
        }

        // 3. Fallback calculation using line lengths
        const zeroIdx = renderData.zeroIndex;
        let charDelta = 0;
        if (targetIdx > zeroIdx) {
            for (let k = zeroIdx; k < targetIdx; k++) {
                const l = renderData.lines[k];
                const len = typeof l === 'string' ? l.length : (l?.length ?? 0);
                charDelta += len + 1;
            }
        } else if (targetIdx < zeroIdx) {
            for (let k = targetIdx; k < zeroIdx; k++) {
                const l = renderData.lines[k];
                const len = typeof l === 'string' ? l.length : (l?.length ?? 0);
                charDelta -= (len + 1);
            }
        }

        const currentOffset = Math.round(renderData.progress * totalLen);
        const newOffset = Math.max(0, Math.min(totalLen, currentOffset + charDelta));
        return newOffset / totalLen;
    }

    /**
     * Snap displacement to nearest line and commit new progress to ReadingDocument
     */
    commitScroll() {
        if (!this.doc || !this.engine) return;

        const lineHeight = this.engine.lineHeight;
        const isVert = this.engine.writingMode === 'vertical';
        const linesScrolled = isVert
            ? Math.round(this.scrollOffset / lineHeight)
            : -Math.round(this.scrollOffset / lineHeight);

        const renderData = this.engine.getRenderData(this.doc);
        if (renderData && renderData.lines && renderData.lines.length > 0 && linesScrolled !== 0) {
            const targetIdx = Math.max(0, Math.min(renderData.lines.length - 1, renderData.zeroIndex + linesScrolled));
            const newProgress = this.calculateProgressAtLine(renderData, targetIdx);
            this.doc.setProgress(newProgress);
        }

        this.scrollOffset = 0;
        this.render(true);
    }

    handleClick(e) {
        if (!this.doc) return;
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Middle 40% toggles UI
        const isMiddleX = x > rect.width * 0.3 && x < rect.width * 0.7;
        const isMiddleY = y > rect.height * 0.3 && y < rect.height * 0.7;

        if (isMiddleX && isMiddleY) {
            if (this.app && typeof this.app.toggleUI === 'function') {
                this.app.toggleUI();
            }
            return;
        }

        const hw = rect.width / 2;
        const hh = rect.height / 2;
        let action = 'none';

        if (x < hw && y < hh) action = this.app.quadTL || 'prev';
        else if (x >= hw && y < hh) action = this.app.quadTR || 'next';
        else if (x < hw && y >= hh) action = this.app.quadBL || 'prev';
        else action = this.app.quadBR || 'next';

        this.executeAction(action);
    }

    nextPage() {
        this.executeAction('next');
    }

    prevPage() {
        this.executeAction('prev');
    }

    executeAction(action) {
        if (!this.doc || !this.engine) return;

        const linesPerPage = this.engine.linesPerPage;
        // Keep 1 line overlap for reading continuity
        const linesToJump = Math.max(1, linesPerPage > 1 ? linesPerPage - 1 : 1);

        const renderData = this.engine.getRenderData(this.doc);
        if (!renderData || !renderData.lines || renderData.lines.length === 0) return;

        let targetIdx = renderData.zeroIndex;
        if (action === 'next') {
            targetIdx = Math.min(renderData.lines.length - 1, renderData.zeroIndex + linesToJump);
        } else if (action === 'prev') {
            targetIdx = Math.max(0, renderData.zeroIndex - linesToJump);
        } else {
            return;
        }

        const newProgress = this.calculateProgressAtLine(renderData, targetIdx);
        this.doc.setProgress(newProgress);

        this.scrollOffset = 0;
        this.render(true);
    }
}

window.ReadingPanel = ReadingPanel;
