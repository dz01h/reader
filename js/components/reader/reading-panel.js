class ReadingPanel extends Component {
    constructor() {
        super();

        // State
        this.doc = null;
        this.engine = null;
        this.scrollOffset = 0; // Drag displacement in CSS logical pixels relative to zeroIndex

        // Inertia / Drag State
        this.dragging = null;

        this.dragGap = 8; // Displacement threshold (px) beyond which click action is ignored
        this.inertiaFrameId = null;

        this.initComponent();
    }

    initComponent() {
        const canvas = this.canvas = document.createElement('canvas');
        canvas.classList.add('reader-canvas');
        canvas.style.touchAction = 'none';
        this.style.touchAction = 'none';
        (new ResizeObserver(this.resize.bind(this))).observe(canvas);
        this.appendChild(canvas);
        this.ctx = this.canvas.getContext('2d');

        // Pointer Events (Unifies mouse, touch and pen interactions)
        canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
        canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
        canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
        canvas.addEventListener('pointercancel', (e) => this.onPointerCancel(e));

        // ReadingOperation Event Listener (Next / Prev / Page Actions)
        document.body.addEventListener('ReadingOperation', (e) => {
            if (e.detail && e.detail.action && typeof this[e.detail.action] === 'function') {
                this[e.detail.action](...(e.detail.params ?? []));
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
        if (!this.canvas || !this.doc || !window._app) return;
        const rect = this.canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        const app = window._app;
        const config = {
            width: rect.width,
            height: rect.height,
            fontSize: app.fontSize ?? 18,
            fontFamily: app.fontFamily ?? 'sans-serif',
            lineHeightRatio: app.lineHeight ?? 1.8,
            margins: app.margins ?? { top: 30, bottom: 30, left: 30, right: 30 },
            writingMode: app.writingMode ?? 'horizontal',
            wordSpacing: app.wordSpacing ?? 1
        };

        if (!this.engine) {
            this.engine = new window.TextRenderEngine(config);
        } else {
            this.engine.updateConfig(config);
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

        // Fire ReadingPanelRenderOver event with visible text ONLY when stable (debounced / committed)
        if (stable) {
            const rendingData = this.engine.getRenderData(this.doc);
            this.fireEvent('ReadingPanelRenderOver', rendingData, true);
        }
    }

    prepareInertia(e) {
        const coord = (this.engine.writingMode === 'vertical') ? 'screenX' : 'screenY';
        const inertia  = {
            position: e[coord],
            velocity: 0,
            time: performance.now()
        };
        inertia.update = (function(e) {
            const delta = e[coord] - this.position;
            const now = performance.now();
            const dt = Math.max(1, now - this.time);
            this.velocity = (delta / dt) * 16.67;
            this.position = e[coord];
            this.time = now;
            return delta;
        }).bind(inertia);
        return inertia;
    }

    onPointerDown(e) {
        if (!this.doc || !this.engine) return;
        // Ignore secondary mouse buttons (e.g. right-click)
        if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;

        if (this.inertiaFrameId) {
            cancelAnimationFrame(this.inertiaFrameId);
            this.inertiaFrameId = null;
        }

        const pointerId = e.pointerId;

        try {
            this.canvas.setPointerCapture(pointerId);
        } catch (err) {}

        this.dragging = {
            activePointerId: pointerId,
            x: e.clientX,
            y: e.clientY,
            isDrag: false,
            inertia: this.prepareInertia(e)
        };

        this.dragging.end = () => {
            try {
                if (this.canvas.hasPointerCapture && this.canvas.hasPointerCapture(pointerId)) {
                    this.canvas.releasePointerCapture(pointerId);
                }
            } catch (err) {}
            return null;
        };
    }

    onPointerMove(e) {
        if (!this.dragging || !this.doc || !this.engine) return;
        if (e.pointerId !== this.dragging.activePointerId) return;
        e.preventDefault();

        const dist = Math.hypot(e.clientX - this.dragging.x, e.clientY - this.dragging.y);
        this.dragging.isDrag ||= (dist > this.dragGap);

        // Content strictly follows pointer displacement
        const delta = this.dragging.inertia.update(e);

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

    onPointerUp(e) {
        console.log(e);
        if (!this.dragging || e.pointerId !== this.dragging.activePointerId) return;
        const dragging = this.dragging;
        this.dragging = null;

        if (Math.abs(dragging.inertia.velocity) > 1.5) {
            this.startInertialScroll(dragging.inertia.velocity * 12, 0.92);
        } else {
            this.commitScroll();
        }

        if(!dragging.isDrag) {
            const options = {};
            for(let k in PointerEvent.prototype) {
                if(typeof e[k] !== 'function') {
                    options[k] = e[k];
                }
            }
            this.fireEvent(new PointerEvent('click', options));
        }
    }

    onPointerCancel(e) {
        if (!this.dragging || e.pointerId !== this.dragging.activePointerId) return;
        this.dragging = this.dragging.end();
        this.commitScroll();
    }

    startInertialScroll(totalDisplacement, friction = 0.92) {
        if (this.inertiaFrameId) {
            cancelAnimationFrame(this.inertiaFrameId);
            this.inertiaFrameId = null;
        }

        let currentV = totalDisplacement * (1 - friction);

        const loop = () => {
            if (this.dragging) {
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

ReadingPanel.ScrollOperator = class {
    constructor(pointerEvent) {
        this.target = pointerEvent.target;
        this.panel = pointerEvent.target.parentElement;
        this.activePointerId = pointerEvent.pointerId;
        this.x = pointerEvent.clientX;
        this.y = pointerEvent.clientY;
        this.isDrag = false;

        this.coord = (this.engine.writingMode === 'vertical') ? 'screenX' : 'screenY';
        this.velocity = 0;
        this.position = pointerEvent[this.coord];
        this.time = performance.now();

        this.target.setPointerCapture(this.activePointerId);
    }

    update(pointerEvent) {
        const delta = pointerEvent[coord] - this.position;
        const now = performance.now();
        const dt = Math.max(1, now - this.time);
        this.velocity = (delta / dt) * 16.67;
        this.position = pointerEvent[coord];
        this.time = now;
    }

    finish() {
        if(this.target.hasPointerCapture(this.activePointerId)) {
            this.target.releasePointerCapture(this.activePointerId);
        }
    }

    startInertialScroll(totalDisplacement, friction = 0.92) {
        if (this.inertiaFrameId) {
            cancelAnimationFrame(this.inertiaFrameId);
            this.inertiaFrameId = null;
        }

        let currentV = totalDisplacement * (1 - friction);

        const loop = () => {
            if (this.dragging) {
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


};


window.ReadingPanel = ReadingPanel;
customElements.define('reading-panel', ReadingPanel);
