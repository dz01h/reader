class TextRenderEngine {
    constructor(options = {}) {
        this.width = options.width || 800;
        this.height = options.height || 600;
        this.fontSize = options.fontSize || 18;
        this.fontFamily = options.fontFamily || 'sans-serif';
        this.lineHeightRatio = options.lineHeightRatio || 2.0;
        this.margins = options.margins || { top: 30, bottom: 30, left: 30, right: 30 };
        this.writingMode = options.writingMode || 'horizontal'; // 'horizontal' | 'vertical'

        // Layout & Segmentation Rules (from ZenEngine)
        this.tocRegex = /^\s*(第[零一二三四五六七八九十百千萬0-9０-９]+[章回節卷]|Chapter\s*[0-9]+|正文|楔子|前言|番外)/i;
        this.forceRotateRegex = /^[(){}\[\]〈〉《》「」『』【】〔〕〖〗〘〙〚〛〜︗︘︵︶︷︸︹︺︻︼︽︾︿﹀﹁﹂﹃﹄﹇﹈﹙﹚﹛﹜﹝﹞（）［］｛｝～｟｠｢｣—…｜～]$/;

        // Kinsoku Shori (避頭尾規則)
        this.kinsokuHeadRegex = /^[，。、？！：；）》」』】〕〗〙〛︶︸︺︼︾﹀﹂﹄﹈’”]/; // 不可置於行首
        this.kinsokuTailRegex = /^[（《「『【〔〖〘〚︵︷︹︻︽︿﹁﹃﹇‘“]/; // 不可置於行尾

        this.wordSpacing = 1; // Additional spacing between words (in pixels)
        this.renderCache = null; // Sliding window render cache
    }

    /**
     * Line height in pixels
     */
    get lineHeight() {
        return Math.ceil(this.fontSize * this.lineHeightRatio);
    }

    /**
     * Usable content width (excluding margins)
     */
    get contentWidth() {
        return Math.max(0, this.width - this.margins.left - this.margins.right);
    }

    /**
     * Usable content height (excluding margins)
     */
    get contentHeight() {
        return Math.max(0, this.height - this.margins.top - this.margins.bottom);
    }

    /**
     * Length of a single line of text (height in vertical mode, width in horizontal mode)
     */
    get maxLineLength() {
        return this.writingMode === 'vertical' ? this.contentHeight : this.contentWidth;
    }

    /**
     * Line flow span (usable content span in the line progression direction)
     */
    get lineFlowSpan() {
        return this.writingMode === 'vertical' ? this.contentWidth : this.contentHeight;
    }

    /**
     * Number of lines visible on a single page
     */
    get linesPerPage() {
        return Math.max(1, Math.floor(this.lineFlowSpan/ this.lineHeight));
    }

    /**
     * Centering grid padding offset
     */
    get gridPadding() {
        const contentSize = this.lineHeight * (this.linesPerPage - 1) + this.fontSize;
        return Math.max(0, Math.floor((this.lineFlowSpan - contentSize) / 2));
    }

    /**
     * Snap scrollOffset to nearest line boundary
     * @param {number} scrollOffset
     * @returns {number}
     */
    snap(scrollOffset) {
        return Math.round(scrollOffset / this.lineHeight) * this.lineHeight;
    }

    updateSize(canvas) {
        this.dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
        this.width = canvas.clientWidth || canvas.offsetWidth;
        this.height = canvas.clientHeight || canvas.offsetHeight;
        canvas.width = this.width * this.dpr;
        canvas.height = this.height * this.dpr;
    }

    /**
     * Update engine dimensions and configuration
     * @param {Object} options
     */
    updateConfig(options = {}) {
        if (options.width !== undefined) this.width = options.width;
        if (options.height !== undefined) this.height = options.height;
        if (options.fontSize !== undefined) this.fontSize = options.fontSize;
        if (options.fontFamily !== undefined) this.fontFamily = options.fontFamily;
        if (options.lineHeightRatio !== undefined) this.lineHeightRatio = options.lineHeightRatio;
        if (options.margins !== undefined) this.margins = { ...this.margins, ...options.margins };
        if (options.writingMode !== undefined) this.writingMode = options.writingMode;
        if (options.dpr !== undefined) this.dpr = options.dpr;
        if (options.wordSpacing !== undefined) this.wordSpacing = options.wordSpacing;

        // Invalidate cached measurements and render window when config changes
        this.renderCache = null;
        if (options.fontSize !== undefined || options.fontFamily !== undefined) {
            this.charSizeMap = null;
        }
    }

    getCharSizeMap() {
        if(!this.charSizeMap) {
            this.charSizeMap = [];
            const measurer = new OffscreenCanvas(1, 1).getContext('2d');
            measurer.font = `${this.fontSize}px ${this.fontFamily}`;
            for(let i = 32; i < 127; i++) {
                const char = String.fromCharCode(i);
                this.charSizeMap[char] = measurer.measureText(char).width;
            }

            this.charSizeMap.cal = (function(str) {
                let totalWidth = 0;
                for(let i = 0; i < str.length; i++) {
                    totalWidth += this[str[i]] ?? this[' ']; // Fallback to space width for unknown chars
                }
                return totalWidth;
            }).bind(this.charSizeMap);
        }
        return this.charSizeMap;
    }


    /**
     * Format a single paragraph line into wrapped lines and their text character offsets
     * @param {string} lineText
     * @param {number} [baseOffset] Starting character offset of this paragraph in the document
     * @returns {{ lines: Array<string>, lineIndexs: Array<number> }}
     */
    inlineLayout(lineText, baseOffset = 0) {
        const maxLineLength = this.maxLineLength;
        const wordSpacing = this.wordSpacing || 0;
        const asciiCharSize = this.getCharSizeMap(); // Map of ASCII characters to their widths in pixels

        // 拆成：非 ASCII 字元（單字）、ASCII 英文單字區塊、以及獨立的空白字元（Space/Tab）
        const segments = lineText.split(/([^\x00-\x7F]|\s+)/).filter((s) => s);

        const lines = [];
        const lineIndexs = [];
        let p = -wordSpacing; // Start with negative spacing to offset the first character
        let buffer = "";
        let lineStartInParagraph = -1;
        let charIndex = 0;

        const flushLine = () => {
            if (buffer.length > 0) {
                lines.push(buffer);
                lineIndexs.push(baseOffset + (lineStartInParagraph !== -1 ? lineStartInParagraph : 0));
                buffer = "";
            }
            p = -wordSpacing;
            lineStartInParagraph = -1;
        };

        for (let segment of segments) {
            const segLen = segment.length;
            const isSpace = /^\s+$/.test(segment);

            // Skip leading spaces at the start of a line
            if (!buffer.length && isSpace) {
                charIndex += segLen;
                continue;
            }

            let segmentSize = this.fontSize;
            const isAscii = segment.charCodeAt(0) < 128;
            if (isAscii && (this.writingMode === 'horizontal' || isSpace || segment.length > 2)) {
                segmentSize = asciiCharSize.cal(segment);
            }
            segmentSize += wordSpacing;

            if (p + segmentSize > maxLineLength && buffer.length > 0) {
                flushLine();
                if (isSpace) {
                    charIndex += segLen;
                    continue;
                }
            }

            if (segmentSize > maxLineLength && isAscii && !isSpace) {
                // If a single segment exceeds the max line length, split it character by character
                for (let i = 0; i < segment.length; i++) {
                    const char = segment[i];
                    const charSize = (asciiCharSize[char] || asciiCharSize[' ']) + wordSpacing;
                    if (p + charSize > maxLineLength && buffer.length > 0) {
                        flushLine();
                    }
                    if (lineStartInParagraph === -1) {
                        lineStartInParagraph = charIndex + i;
                    }
                    buffer += char;
                    p += charSize;
                }
            } else {
                if (lineStartInParagraph === -1) {
                    lineStartInParagraph = charIndex;
                }
                buffer += segment;
                p += segmentSize;
            }

            charIndex += segLen;
        }

        flushLine();

        const result = { lines, lineIndexs };
        // Allow iterating directly: for (let l of inlineLayout(...))
        result[Symbol.iterator] = function*() {
            yield* this.lines;
        };

        return result;
    }

    /**
     * Get or format sliding window render data for the document at its current progress
     * Compares cached progress with doc.progress, and only formats when changed or forced.
     * @param {ReadingDocument} doc 
     * @param {number|boolean} [lineNumberOrForce] Number of lines or boolean forceUpdate
     * @param {boolean} [forceUpdate] 
     * @returns {{ progress: number, lines: Array<string>, lineIndexs: Array<number>, zeroIndex: number, totalLength: number, totalLines: number } | null}
     */
    getRenderData(doc, lineNumberOrForce = 50, forceUpdate = false) {
        if (!doc || !doc.text) {
            this.renderCache = null;
            return null;
        }

        let lineNumber = 50;
        let force = false;
        if (typeof lineNumberOrForce === 'boolean') {
            force = lineNumberOrForce;
        } else if (typeof lineNumberOrForce === 'number') {
            lineNumber = lineNumberOrForce;
            force = !!forceUpdate;
        }

        // Return cached window if progress and document are identical
        if (
            !force &&
            this.renderCache &&
            this.renderCache.progress === doc.progress
        ) {
            return this.renderCache;
        }

        const rawData = doc.getRenderData(lineNumber);
        if (!rawData || !rawData.lines) {
            this.renderCache = null;
            return null;
        }

        const formattedLines = [];
        const formattedLineIndexs = [];
        let formattedZeroIndex = 0;

        for (let i = 0; i < rawData.lines.length; i++) {
            const rawLine = rawData.lines[i];
            const rawPos = rawData.lineIndexs ? rawData.lineIndexs[i] : (rawData.startCharOffset || 0);

            if (i === rawData.zeroIndex) {
                formattedZeroIndex = formattedLines.length;
            }

            if (rawLine.trim().length === 0) {
                formattedLines.push('');
                formattedLineIndexs.push(rawPos);
            } else {
                const layoutRes = this.inlineLayout(rawLine, rawPos);
                for (let k = 0; k < layoutRes.lines.length; k++) {
                    formattedLines.push(layoutRes.lines[k]);
                    formattedLineIndexs.push(layoutRes.lineIndexs[k]);
                }
            }
        }

        rawData.lines = formattedLines;
        rawData.lineIndexs = formattedLineIndexs;
        rawData.zeroIndex = formattedZeroIndex;
        rawData.totalLines = formattedLines.length;
        rawData.totalLength = rawData.totalLength || doc.text.length;

        this.renderCache = rawData;

        return this.renderCache;
    }

    /**
     * Direct canvas rendering of document using windowed on-demand render data
     * Supports overriding layout/styling properties via `options` for real-time settings preview
     * Automatically handles Retina display DPR scaling internally; all offsets and metrics are in CSS logical pixels.
     * @param {CanvasRenderingContext2D} ctx
     * @param {ReadingDocument} doc
     * @param {number} scrollOffset Screen dragging offset in CSS logical pixels (0 = anchor at top/right)
     * @param {Object} options Options to override internal config (fontSize, fontFamily, lineHeightRatio, margins, writingMode, width, height, textColor, showMargins, marginOverlayColor, dpr, forceUpdate)
     */
    render(ctx, doc, scrollOffset = 0, options = {}) {
        if (!doc || !doc.text) return;

        // 1. Get windowed render data
        const renderData = this.getRenderData(doc, options.forceUpdate);
        if (!renderData || !renderData.lines || renderData.lines.length === 0) return;

        const { lines, zeroIndex } = renderData;

        // 2. Resolve parameters & DPR
        const dpr = this.dpr;
        const width = options.width !== undefined ? options.width : this.width;
        const height = options.height !== undefined ? options.height : this.height;
        const fontSize = options.fontSize !== undefined ? options.fontSize : this.fontSize;
        const fontFamily = options.fontFamily !== undefined ? options.fontFamily : this.fontFamily;
        const lineHeightRatio = options.lineHeightRatio !== undefined ? options.lineHeightRatio : this.lineHeightRatio;
        const margins = options.margins !== undefined ? { ...this.margins, ...options.margins } : this.margins;
        const writingMode = options.writingMode !== undefined ? options.writingMode : this.writingMode;
        const textColor = options.textColor || '#ffffff';
        const wordSpacing = options.wordSpacing !== undefined ? options.wordSpacing : (this.wordSpacing || 0);

        const isVert = writingMode === 'vertical';
        const lineHeight = fontSize * lineHeightRatio;

        // Effective linesPerPage based on resolved logical options
        const span = isVert
            ? Math.max(0, width - margins.left - margins.right)
            : Math.max(0, height - margins.top - margins.bottom);
        // const linesPerPage = span < fontSize ? 1 : Math.max(1, Math.floor((span - fontSize) / lineHeight) + 1);
        const linesPerPage = span < fontSize ? 1 : Math.max(1, Math.floor(span / lineHeight));
        const contentSize = lineHeight * (linesPerPage - 1) + fontSize;
        const gridPadding = Math.max(0, Math.floor((span - contentSize) / 2));

        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Clear entire canvas to eliminate ghosting / trails from previous frames
        ctx.clearRect(0, 0, width, height);

        // Clip to usable content area with outward safety buffer to protect protruding glyph strokes (e.g. 竹字頭, accents, ascenders)
        const clipBuffer = Math.max(4, Math.ceil(fontSize * 0.15));
        ctx.beginPath();
        ctx.rect(
            Math.max(0, margins.left - clipBuffer),
            Math.max(0, margins.top - clipBuffer),
            Math.min(width, width - margins.left - margins.right + clipBuffer * 2),
            Math.min(height, height - margins.top - margins.bottom + clipBuffer * 2)
        );
        ctx.clip();

        ctx.fillStyle = textColor;
        ctx.font = `${fontSize}px ${fontFamily}`;
        ctx.textBaseline = 'top';

        // 3. Render lines relative to zeroIndex and scrollOffset
        for (let i = 0; i < lines.length; i++) {
            const lineText = lines[i];
            if (!lineText) continue;

            const relativeIdx = i - zeroIndex;
            const lineShift = relativeIdx * lineHeight;

            if (isVert) {
                const x = width - margins.right - gridPadding - fontSize - lineShift + scrollOffset;
                const y = margins.top;

                // Viewport horizontal culling
                if (x + fontSize < margins.left || x > width - margins.right) {
                    continue;
                }
                this.renderVerticalLine(ctx, lineText, x, y, fontSize, wordSpacing);
            } else {
                const x = margins.left;
                const y = margins.top + gridPadding + lineShift + scrollOffset;

                // Viewport vertical culling
                if (y + lineHeight < margins.top || y > height - margins.bottom) {
                    continue;
                }
                this.renderHorizontalLine(ctx, lineText, x, y, fontSize, wordSpacing);
            }
        }

        ctx.restore();

        // 4. Optional Margin Overlay
        if (options.showMargins || options.drawMarginOverlay) {
            ctx.save();
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            this.drawMarginOverlays(ctx, width, height, margins, options.marginOverlayColor);
            ctx.restore();
        }
    }

    /**
     * Draw visual guidelines for margins (for settings / layout debugging)
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} w
     * @param {number} h
     * @param {Object} m Margins { top, bottom, left, right }
     * @param {string} color
     */
    drawMarginOverlays(ctx, w, h, m, color = 'rgba(255, 204, 0, 0.35)') {
        ctx.save();
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, w, m.top); // Top bar
        ctx.fillRect(0, h - m.bottom, w, m.bottom); // Bottom bar
        ctx.fillRect(0, m.top, m.left, h - m.top - m.bottom); // Left bar
        ctx.fillRect(w - m.right, m.top, m.right, h - m.top - m.bottom); // Right bar
        ctx.restore();
    }

    /**
     * Render a single line in horizontal mode with segment-level wordSpacing
     * @param {CanvasRenderingContext2D} ctx
     * @param {string} lineText
     * @param {number} x
     * @param {number} y
     * @param {number} fontSize
     * @param {number} wordSpacing
     */
    renderHorizontalLine(ctx, lineText, x, y, fontSize = this.fontSize, wordSpacing = 0) {
        const segments = lineText.split(/([^\x00-\x7F]|\s)/).filter((s) => s);
        let curX = x;

        for (let segment of segments) {
            const isAscii = segment.charCodeAt(0) < 128;
            ctx.fillText(segment, curX, y);
            curX += (isAscii ? ctx.measureText(segment).width : fontSize) + wordSpacing;
        }
    }

    /**
     * Render a single line in vertical mode with segment-level wordSpacing & punctuation rotation
     * @param {CanvasRenderingContext2D} ctx
     * @param {string} lineText
     * @param {number} x
     * @param {number} y
     * @param {number} fontSize
     * @param {number} wordSpacing
     */
    renderVerticalLine(ctx, lineText, x, y, fontSize = this.fontSize, wordSpacing = 0) {
        const segments = lineText.split(/([^\x00-\x7F]|\s)/).filter((s) => s);
        let curY = y;

        for (let segment of segments) {
            const isAscii = segment.charCodeAt(0) < 128;

            if (!isAscii) {
                // Non-ASCII character (CJK / Full-width punctuation)
                if (this.forceRotateRegex.test(segment)) {
                    ctx.save();
                    ctx.translate(x + fontSize / 2, curY + fontSize / 2);
                    ctx.rotate(Math.PI / 2);
                    ctx.fillText(segment, -fontSize / 2, -fontSize / 2);
                    ctx.restore();
                } else {
                    ctx.fillText(segment, x, curY);
                }
                curY += fontSize + wordSpacing;
            } else {
                // ASCII segment (Digits, English words, or Spaces)
                const segLen = ctx.measureText(segment).width;
                if (segment.length <= 2) {
                    // Tate-chu-yoko (縱中橫排 for 1~2 digits)
                    const drawX = x + (fontSize - segLen) / 2;
                    ctx.fillText(segment, drawX, curY);
                    curY += fontSize;
                } else if (/^\s+$/.test(segment)) {
                    curY += segLen;
                } else {
                    // Rotated English word
                    ctx.save();
                    ctx.translate(x + fontSize / 2, curY);
                    ctx.rotate(Math.PI / 2);
                    ctx.textBaseline = 'middle';
                    ctx.fillText(segment, 0, 0);
                    ctx.restore();
                    curY += segLen;
                }
                curY += wordSpacing; // Add spacing after ASCII segment
            }
        }
    }
}

window.TextRenderEngine = TextRenderEngine;
