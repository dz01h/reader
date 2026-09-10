class TextRenderEngine {
    constructor(options = {}) {
        this.width = options.width || 800;
        this.height = options.height || 600;
        this.fontSize = options.fontSize || 18;
        this.fontFamily = options.fontFamily || 'sans-serif';
        this.lineHeightRatio = options.lineHeightRatio || 1.8;
        this.margins = options.margins || { top: 30, bottom: 30, left: 30, right: 30 };
        this.writingMode = options.writingMode || 'horizontal'; // 'horizontal' | 'vertical'

        // Layout & Segmentation Rules (from ZenEngine)
        this.tocRegex = /^\s*(第[零一二三四五六七八九十百千萬0-9０-９]+[章回節卷]|Chapter\s*[0-9]+|正文|楔子|前言|番外)/i;
        this.forceRotateRegex = /^[(){}\[\]〈〉《》「」『』【】〔〕〖〗〘〙〚〛〜︗︘︵︶︷︸︹︺︻︼︽︾︿﹀﹁﹂﹃﹄﹇﹈﹙﹚﹛﹜﹝﹞（）［］｛｝～｟｠｢｣—…｜～]$/;

        // Kinsoku Shori (避頭尾規則)
        this.kinsokuHeadRegex = /^[，。、？！：；）》」』】〕〗〙〛︶︸︺︼︾﹀﹂﹄﹈’”]/; // 不可置於行首
        this.kinsokuTailRegex = /^[（《「『【〔〖〘〚︵︷︹︻︽︿﹁﹃﹇‘“]/; // 不可置於行尾

        this.wordSpacing = 1; // Additional spacing between words (in pixels)

        //
    }

    /**
     * Line height in pixels
     */
    get lineHeight() {
        return Math.ceil(this.fontSize * this.lineHeightRatio);
    }

    /**
     * Usable content width (excluding margins and inner padding)
     */
    get contentWidth() {
        const padX = Math.max(4, this.fontSize * 0.1);
        return Math.max(0, this.width - this.margins.left - this.margins.right - padX * 2);
    }

    /**
     * Usable content height (excluding margins and inner padding)
     */
    get contentHeight() {
        const padY = Math.max(4, this.fontSize * 0.1);
        return Math.max(0, this.height - this.margins.top - this.margins.bottom - padY * 2);
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
        return Math.max(1, Math.floor((this.lineFlowSpan - this.fontSize) / this.lineHeight) + 1);
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

        // Invalidate cached character measurements when font settings change
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


    inlineLayout(lineText, baseIndex = 0) {
        if (!lineText) return [[baseIndex, 0]];

        const maxLineLength = this.maxLineLength;
        const wordSpacing = this.wordSpacing || 0;
        const asciiCharSize = this.getCharSizeMap(); // Map of ASCII characters to their widths in pixels

        // 拆成：非 ASCII 字元（單字）、ASCII 英文單字區塊、以及獨立的空白字元（Space/Tab）
        const segments = lineText.split(/([^\x00-\x7F]|\s+)/).filter((s) => s);

        const rez = [];
        let p = -wordSpacing; // Start with negative spacing to offset the first character
        let idx = baseIndex;
        let position = null;
0
        for (let segment of segments) {
            if(!position) position = [idx, 0];
            const isSpace = /\s+/.test(segment);
            if(position[1] === 0 && isSpace) {
                idx += segment.length; // Advance index for skipped spaces
                position[0] = idx;
                continue; // Skip leading spaces at the start of a line
            }

            let segmentSize = this.fontSize;
            const isAscii = segment.charCodeAt(0) < 128;
            if (isAscii && (this.writingMode === 'horizontal' || isSpace || segment.length > 2)) {
                segmentSize = asciiCharSize.cal(segment);
            }
            segmentSize += wordSpacing;

            if (p + segmentSize > maxLineLength) {
                if (position[1] > 0) rez.push(position);
                position = [idx, 0];
                p = -wordSpacing; // Reset position for new line
            }

            if (segmentSize > maxLineLength) {
                // If a single segment exceeds the max line length, split it
                let l = 0;
                let inlinePos = [idx, 0];
                for (let i = 0; i < segment.length; i++) {
                    const char = segment[i];
                    const charSize = (asciiCharSize[char] || asciiCharSize[' ']) + wordSpacing;
                    if (l + charSize > maxLineLength) {
                        if (inlinePos[1] > 0) rez.push(inlinePos);
                        inlinePos = [idx + i, 0];
                        l = 0;
                    }
                    inlinePos[1]++;
                    l += charSize;
                }
                if (inlinePos[1] > 0) rez.push(inlinePos);
            } else {
                position[1] += segment.length;
                p += segmentSize;
            }
            idx += segment.length;
        }
        if (position && position[1] > 0) rez.push(position);

        return rez;
    }

    /**
     * Format raw text into line slices [startOffset, length] and chapter bookmarks
     * Splits by newlines and uses inlineLayout to format each paragraph into renderable lines
     * @param {string} text
     * @returns {{ lines: Array<[number, number]>, chapters: Array<{title: string, lineIndex: number, charOffset: number}> }}
     */
    formatText(text) {
        if (!text) return { lines: [], chapters: [] };

        const startTime = performance.now();
        const lines = [];
        const chapters = [];
        let ptr = 0;
        const totalLen = text.length;

        while (ptr < totalLen) {
            const nextNewline = text.indexOf('\n', ptr);
            const rawEnd = nextNewline === -1 ? totalLen : nextNewline;

            // Trim trailing \r if present
            let lineEnd = rawEnd;
            if (lineEnd > ptr && text[lineEnd - 1] === '\r') {
                lineEnd--;
            }

            const rawLine = text.substring(ptr, lineEnd);

            // 1. Chapter Title Detection
            if (rawLine.length < 50 && this.tocRegex.test(rawLine)) {
                // Pre-spacing: 2 empty lines before chapter title (except at document start)
                if (lines.length > 0) {
                    lines.push([ptr, 0]);
                    lines.push([ptr, 0]);
                }
                chapters.push({
                    title: rawLine.trim(),
                    lineIndex: lines.length,
                    charOffset: ptr
                });
            }

            // 2. Format line using inlineLayout (跳過完全空白或僅含空白字元的行)
            if (rawLine.trim().length === 0) {
                lines.push([ptr, 0]);
            } else {
                const subLines = this.inlineLayout(rawLine, ptr);
                for (let i = 0; i < subLines.length; i++) {
                    lines.push(subLines[i]);
                }
            }

            // Advance pointer past \n
            ptr = rawEnd + 1;
        }

        const elapsed = (performance.now() - startTime).toFixed(2);
        console.log(`[TextRenderEngine] Format completed: ${totalLen.toLocaleString()} chars, ${lines.length.toLocaleString()} lines, ${chapters.length} chapters in ${elapsed}ms`);

        return { lines, chapters };
    }

    /**
     * Calculate maximum scroll offset for a ReadingDocument
     * @param {ReadingDocument} doc
     * @returns {number}
     */
    getMaxScroll(doc) {
        if (!doc || doc.getLineCount() === 0) return 0;
        const totalLines = doc.getLineCount();
        const visibleLines = this.linesPerPage;
        const maxScrollLines = Math.max(0, totalLines - visibleLines);
        return maxScrollLines * this.lineHeight;
    }

    /**
     * Get visible line range [startLine, endLine] from current scroll offset
     * @param {number} scrollOffset
     * @param {number} totalLines
     * @returns {{ startLine: number, endLine: number }}
     */
    getVisibleLineRange(scrollOffset, totalLines = Infinity) {
        const startLine = Math.max(0, Math.floor(scrollOffset / this.lineHeight));
        const endLine = Math.min(totalLines - 1, startLine + this.linesPerPage);
        return { startLine, endLine };
    }

    /**
     * Snap scrollOffset to nearest line boundary
     * @param {number} scrollOffset
     * @returns {number}
     */
    snapOffsetToLine(scrollOffset) {
        const lineIdx = Math.round(scrollOffset / this.lineHeight);
        return lineIdx * this.lineHeight;
    }

    /**
     * Direct canvas rendering of document at given scroll offset
     * Supports overriding layout/styling properties via `options` for real-time settings preview
     * Automatically handles Retina display DPR scaling internally; all offsets and metrics are in CSS logical pixels.
     * @param {CanvasRenderingContext2D} ctx
     * @param {ReadingDocument} doc
     * @param {number} scrollOffset Scroll offset in CSS logical pixels
     * @param {Object} options Options to override internal config (fontSize, fontFamily, lineHeightRatio, margins, writingMode, width, height, textColor, showMargins, marginOverlayColor, dpr)
     */
    render(ctx, doc, scrollOffset = 0, options = {}) {
        if (!doc || doc.getLineCount() === 0) return;

        // 1. Resolve and sync DPR scaling
        const dpr = this.dpr;

        // 2. Resolve CSS logical dimensions (options > instance state > canvas client rect)
        const width = options.width !== undefined ? options.width : this.width;
        const height = options.height !== undefined ? options.height : this.height;
        const fontSize = options.fontSize !== undefined ? options.fontSize : this.fontSize;
        const fontFamily = options.fontFamily !== undefined ? options.fontFamily : this.fontFamily;
        const lineHeightRatio = options.lineHeightRatio !== undefined ? options.lineHeightRatio : this.lineHeightRatio;
        const margins = options.margins !== undefined ? { ...this.margins, ...options.margins } : this.margins;
        const writingMode = options.writingMode !== undefined ? options.writingMode : this.writingMode;
        const textColor = options.textColor || '#ffffff';

        const isVert = writingMode === 'vertical';
        const lineHeight = fontSize * lineHeightRatio;
        const padX = Math.max(4, fontSize * 0.1);
        const padY = Math.max(4, fontSize * 0.1);

        // Effective linesPerPage based on resolved logical options
        const span = isVert
            ? Math.max(0, width - margins.left - margins.right - padX * 2)
            : Math.max(0, height - margins.top - margins.bottom - padY * 2);
        const linesPerPage = span < fontSize ? 1 : Math.max(1, Math.floor((span - fontSize) / lineHeight) + 1);
        const contentSize = lineHeight * (linesPerPage - 1) + fontSize;
        const gridPadding = Math.max(0, Math.floor((span - contentSize) / 2));

        const totalLines = doc.getLineCount();
        const startLine = Math.max(0, Math.floor(scrollOffset / lineHeight));
        const endLine = Math.min(totalLines - 1, startLine + linesPerPage);

        ctx.save();

        // 3. Set transform to DPR scale so all drawing calls below operate directly in CSS logical pixels!
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // 3.1 Clear entire canvas to eliminate ghosting / trails from previous frames
        ctx.clearRect(0, 0, width, height);

        // 4. Clip to usable content area (margins)
        ctx.beginPath();
        ctx.rect(
            margins.left,
            margins.top,
            Math.max(0, width - margins.left - margins.right),
            Math.max(0, height - margins.top - margins.bottom)
        );
        ctx.clip();

        // 5. Translate context based on scroll offset (logical pixels)
        if (isVert) {
            ctx.translate(scrollOffset, 0);
        } else {
            ctx.translate(0, -scrollOffset);
        }

        ctx.fillStyle = textColor;
        ctx.font = `${fontSize}px ${fontFamily}`;
        ctx.textBaseline = 'top';

        const wordSpacing = options.wordSpacing !== undefined ? options.wordSpacing : (this.wordSpacing || 0);
        const asciiCharSize = this.getCharSizeMap();

        // When snapped to line, render exact page lines to avoid boundary cut-off artifacts;
        // when scrolling smoothly, add 1-line buffer to prevent edge pop-in.
        const isSnapped = Math.abs(scrollOffset - Math.round(scrollOffset / lineHeight) * lineHeight) < 0.5;
        const renderStart = isSnapped ? startLine : Math.max(0, startLine - 1);
        const renderEnd = isSnapped ? Math.min(totalLines - 1, startLine + linesPerPage - 1) : Math.min(totalLines - 1, endLine + 1);

        for (let i = renderStart; i <= renderEnd; i++) {
            const lineText = doc.getLine(i);
            if (!lineText) continue;

            const lineOffset = i * lineHeight;

            if (isVert) {
                // Vertical layout: lines flow right-to-left
                const x = width - margins.right - padX - gridPadding - fontSize - lineOffset;
                const y = margins.top + padY;
                this.renderVerticalLine(ctx, lineText, x, y, fontSize, wordSpacing, asciiCharSize);
            } else {
                // Horizontal layout: lines flow top-to-bottom
                const x = margins.left + padX;
                const y = margins.top + padY + gridPadding + lineOffset;
                this.renderHorizontalLine(ctx, lineText, x, y, fontSize, wordSpacing, asciiCharSize);
            }
        }

        ctx.restore();

        // 6. Optional: Draw Margin Overlay guidelines (in logical pixels)
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
     * @param {Object} asciiCharSize
     */
    renderHorizontalLine(ctx, lineText, x, y, fontSize = this.fontSize, wordSpacing = 0, asciiCharSize = null) {
        const segments = lineText.split(/([^\x00-\x7F]|\s)/).filter((s) => s);
        let curX = x;

        for (let segment of segments) {
            const isAscii = segment.charCodeAt(0) < 128;
            ctx.fillText(segment, curX, y);
            const segWidth = isAscii
                ? (asciiCharSize ? asciiCharSize.cal(segment) : ctx.measureText(segment).width)
                : fontSize;
            curX += segWidth + wordSpacing;
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
     * @param {Object} asciiCharSize
     */
    renderVerticalLine(ctx, lineText, x, y, fontSize = this.fontSize, wordSpacing = 0, asciiCharSize = null) {
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
                if (/^\d{1,2}$/.test(segment)) {
                    // Tate-chu-yoko (縱中橫排 for 1~2 digits)
                    const w = ctx.measureText(segment).width;
                    const drawX = x + (fontSize - w) / 2;
                    ctx.fillText(segment, drawX, curY);
                    curY += fontSize + wordSpacing;
                } else if (/^\s+$/.test(segment)) {
                    const spaceHeight = asciiCharSize ? asciiCharSize.cal(segment) : (fontSize * 0.5);
                    curY += spaceHeight + wordSpacing;
                } else {
                    // Rotated English word
                    const segLen = asciiCharSize ? asciiCharSize.cal(segment) : ctx.measureText(segment).width;
                    ctx.save();
                    ctx.translate(x + fontSize / 2, curY);
                    ctx.rotate(Math.PI / 2);
                    ctx.textBaseline = 'middle';
                    ctx.fillText(segment, 0, 0);
                    ctx.restore();
                    curY += segLen + wordSpacing;
                }
            }
        }
    }
}

window.TextRenderEngine = TextRenderEngine;
