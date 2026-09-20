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

    render(stable = false, offset = 0) {
        if (!this.doc || !this.engine) return;

        this.engine.render(
            this.ctx,
            this.doc,
            offset,
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
        this.dragging = ReadingPanel.ScrollOperator.start(e);
    }

    onPointerMove(e) {
        if (!this.dragging || e.pointerId !== this.dragging.pid) return;
        e.preventDefault();
        this.dragging.logLastPosition(e);
    }

    onPointerUp(e) {
        if (!this.dragging || e.pointerId !== this.dragging.pid) return;
        this.dragging.finish(e);
        if(!this.dragging.isDrag) {
            const options = {};
            for(let k in PointerEvent.prototype) {
                if(typeof e[k] !== 'function') {
                    options[k] = e[k];
                }
            }
            this.fireEvent(new PointerEvent('click', options));
        }
        this.dragging = null;
    }

    onPointerCancel(e) {
        if (!this.dragging || e.pointerId !== this.dragging.pid) return;
        this.dragging = this.dragging.finish();
        this.commitScroll();
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
     * Returns the residual scroll offset (the gap between current scrollOffset and the snapped line position).
     * @param {number} scrollOffset
     * @returns {number} Residual scroll offset in pixels
     */
    commitScroll(scrollOffset = 0) {
        if (!this.doc || !this.engine) return 0;

        const lineHeight = this.engine.lineHeight;
        const isVert = this.engine.writingMode === 'vertical';
        const linesScrolled = isVert
            ? Math.round(scrollOffset / lineHeight)
            : -Math.round(scrollOffset / lineHeight);

        const renderData = this.engine.getRenderData(this.doc);
        let actualLinesScrolled = 0;

        if (renderData && renderData.lines && renderData.lines.length > 0 && linesScrolled !== 0) {
            const targetIdx = Math.max(0, Math.min(renderData.lines.length - 1, renderData.zeroIndex + linesScrolled));
            actualLinesScrolled = targetIdx - renderData.zeroIndex;
            const newProgress = this.calculateProgressAtLine(renderData, targetIdx);
            this.doc.setProgress(newProgress);
        }

        // 計算被進度磁性吸收的像素位移量 (snapped pixels)
        const snappedPixels = isVert
            ? actualLinesScrolled * lineHeight
            : -actualLinesScrolled * lineHeight;

        // 計算未被吸收的殘留位移差距 (residual offset)
        const residualOffset = scrollOffset - snappedPixels;

        this.render(true);
        return residualOffset;
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
    static friction = 0.92;
    static dragGap = 8;
    static instance;
    static next_id = 1;

    static start(e) {
        const self = ReadingPanel.ScrollOperator;
        let off = 0;
        if (self.instance) {
            const last = self.instance;
            last.finish();
            off = last.target.parentElement.commitScroll(last.scrollOffset);
        }
        self.instance = new ReadingPanel.ScrollOperator(e, off);
        return self.instance;
    }

    constructor(pe, initOffset = 0) {
        this.velocity = 0;
        this.initOffset = initOffset;
        this.scrollOffset = initOffset;
        this.eid = ReadingPanel.ScrollOperator.next_id++;

        this.pid = pe.pointerId;
        this.target = pe.target;
        try {
            this.target.setPointerCapture(this.pid);
        } catch (err) {}

        this.coord = (window._app && window._app.writingMode === 'vertical') ? 'screenX' : 'screenY';
        this.startPos = pe[this.coord];
        this.isDrag = false;
        this.logLastPosition(pe);
        this.startRenderLoop();
    }

    logLastPosition(pe) {
        if (pe.pointerId !== this.pid) return;
        const parent = this.target.parentElement;
        const currentPE = { pos: pe[this.coord], time: performance.now() };
        const moveDist = currentPE.pos - this.startPos;
        this.scrollOffset = this.initOffset + moveDist;
        this.isDrag ||= (Math.abs(moveDist) > ReadingPanel.ScrollOperator.dragGap);
        this.velocity = this.lastPE ? ((currentPE.pos - this.lastPE.pos) * 16 / Math.max(1, currentPE.time - this.lastPE.time)) : 0;
        this.lastPE = currentPE;

        // 拖曳距離過長時（超過 20 行），在拖曳途中平滑換窗
        const lineHeight = parent && parent.engine ? parent.engine.lineHeight : 32;
        if (Math.abs(this.scrollOffset) > 20 * lineHeight) {
            this.initOffset = parent.commitScroll(this.scrollOffset);
            this.startPos = currentPE.pos;
            this.scrollOffset = this.initOffset;
        }
    }

    finish() {
        try {
            if (this.target.hasPointerCapture(this.pid)) {
                this.target.releasePointerCapture(this.pid);
            }
        } catch (err) {}
    }

    startRenderLoop() {
        const parent = this.target.parentElement;
        const self = ReadingPanel.ScrollOperator;

        const loop = () => {
            if (self.instance && self.instance.eid !== this.eid) return;
            const delta = Math.abs(this.velocity);
            const lineHeight = parent && parent.engine ? parent.engine.lineHeight : 32;

            if (!parent.dragging && delta) {
                this.scrollOffset += this.velocity;
                this.velocity *= self.friction;

                // 【方案 2：飛行中動態平滑換窗】
                // 當慣性位移超過 20 行時，在飛行中平滑 Commit 一次，重置視窗中心
                if (Math.abs(this.scrollOffset) > 20 * lineHeight) {
                    const prevOffset = this.scrollOffset;
                    this.scrollOffset = parent.commitScroll(this.scrollOffset);
                    // 若已到達整本書的最前端或最後端（無法再推進），給予速度阻尼
                    if (Math.abs(this.scrollOffset - prevOffset) < 1) {
                        this.velocity *= 0.5;
                    }
                }

                if (delta < 0.5) {
                    self.instance = null;
                    return parent.commitScroll(this.scrollOffset);
                }
            }

            parent.render(false, this.scrollOffset);
            this.inertiaFrameId = (parent.dragging || delta >= 0.5) ? requestAnimationFrame(loop) : null;
        };

        this.inertiaFrameId = requestAnimationFrame(loop);
    }
};


window.ReadingPanel = ReadingPanel;
customElements.define('reading-panel', ReadingPanel);
