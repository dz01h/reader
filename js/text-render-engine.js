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
    }

    /**
     * Line height in pixels
     */
    get lineHeight() {
        return this.fontSize * this.lineHeightRatio;
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
     * Number of lines visible on a single page
     */
    get linesPerPage() {
        const span = this.writingMode === 'vertical' ? this.contentWidth : this.contentHeight;
        if (span < this.fontSize) return 1;
        return Math.max(1, Math.floor((span - this.fontSize) / this.lineHeight) + 1);
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
    }

    /**
     * Format raw text into line slices [startOffset, length] and chapter bookmarks
     * @param {string} text 
     * @returns {{ lines: Array<[number, number]>, chapters: Array<{title: string, lineIndex: number, charOffset: number}> }}
     */
    formatText(text) {
        if (!text) return { lines: [], chapters: [] };

        const lines = [];
        const chapters = [];
        const maxLen = this.maxLineLength;
        const approxCharsPerLine = Math.max(1, Math.floor(maxLen / this.fontSize));

        let ptr = 0;
        const totalLen = text.length;

        // Skip leading whitespace / newlines
        while (ptr < totalLen && (text[ptr] === ' ' || text[ptr] === '　' || text[ptr] === '\r' || text[ptr] === '\n')) {
            ptr++;
        }

        while (ptr < totalLen) {
            // 1. Chapter Title Detection at paragraph start
            const nextNewline = text.indexOf('\n', ptr);
            const paragraphEnd = nextNewline === -1 ? totalLen : nextNewline;
            const paragraphText = text.substring(ptr, paragraphEnd);

            if (paragraphText.length < 50 && this.tocRegex.test(paragraphText)) {
                // Pre-spacing: 2 empty lines before chapter title (except at document start)
                if (lines.length > 0) {
                    lines.push([ptr, 0]);
                    lines.push([ptr, 0]);
                }
                chapters.push({
                    title: paragraphText.trim(),
                    lineIndex: lines.length,
                    charOffset: ptr
                });
            }

            // 2. Wrap paragraph into lines
            let segStart = ptr;
            while (segStart < paragraphEnd) {
                let segLen = Math.min(approxCharsPerLine, paragraphEnd - segStart);
                let segEnd = segStart + segLen;

                // Kinsoku Shori (避頭尾規則)
                if (segEnd < paragraphEnd) {
                    const nextChar = text[segEnd];
                    // If next char cannot be at line head, bring one character down to next line
                    if (this.kinsokuHeadRegex.test(nextChar) && segLen > 1) {
                        segLen -= 1;
                    }
                }

                lines.push([segStart, segLen]);
                segStart += segLen;
            }

            // If empty line in original text
            if (ptr === paragraphEnd) {
                lines.push([ptr, 0]);
            }

            // Advance pointer past \n
            ptr = paragraphEnd + 1;
            while (ptr < totalLen && text[ptr] === '\r') {
                ptr++;
            }
        }

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
     * @param {CanvasRenderingContext2D} ctx 
     * @param {ReadingDocument} doc 
     * @param {number} scrollOffset 
     * @param {Object} options 
     */
    render(ctx, doc, scrollOffset = 0, options = {}) {
        if (!doc || doc.getLineCount() === 0) return;

        const isVert = this.writingMode === 'vertical';
        const totalLines = doc.getLineCount();
        const { startLine, endLine } = this.getVisibleLineRange(scrollOffset, totalLines);

        const textColor = options.textColor || '#ffffff';
        const padX = Math.max(4, this.fontSize * 0.1);
        const padY = Math.max(4, this.fontSize * 0.1);

        ctx.save();

        // Clip to margin area
        ctx.beginPath();
        ctx.rect(
            this.margins.left,
            this.margins.top,
            this.width - this.margins.left - this.margins.right,
            this.height - this.margins.top - this.margins.bottom
        );
        ctx.clip();

        // Translate context based on scroll offset
        if (isVert) {
            ctx.translate(scrollOffset, 0);
        } else {
            ctx.translate(0, -scrollOffset);
        }

        ctx.fillStyle = textColor;
        ctx.font = `${this.fontSize}px ${this.fontFamily}`;
        ctx.textBaseline = 'top';

        // Render buffer: 1 extra line before and after for smooth edge rendering
        const renderStart = Math.max(0, startLine - 1);
        const renderEnd = Math.min(totalLines - 1, endLine + 1);

        for (let i = renderStart; i <= renderEnd; i++) {
            const lineText = doc.getLine(i);
            if (!lineText) continue;

            const lineOffset = i * this.lineHeight;

            if (isVert) {
                // Vertical layout: lines flow right-to-left
                const x = this.width - this.margins.right - padX - this.fontSize - lineOffset;
                const y = this.margins.top + padY;
                this.renderVerticalLine(ctx, lineText, x, y);
            } else {
                // Horizontal layout: lines flow top-to-bottom
                const x = this.margins.left + padX;
                const y = this.margins.top + padY + lineOffset;
                ctx.fillText(lineText, x, y);
            }
        }

        ctx.restore();
    }

    /**
     * Render a single line in vertical mode (with punctuation rotation & tate-chu-yoko)
     * @param {CanvasRenderingContext2D} ctx 
     * @param {string} lineText 
     * @param {number} x 
     * @param {number} y 
     */
    renderVerticalLine(ctx, lineText, x, y) {
        let curY = y;
        const len = lineText.length;

        for (let i = 0; i < len; i++) {
            const char = lineText[i];

            // Tate-chu-yoko (縱中橫排 for 2 consecutive ASCII digits)
            if (/\d/.test(char) && i + 1 < len && /\d/.test(lineText[i + 1])) {
                const numPair = char + lineText[i + 1];
                const w = ctx.measureText(numPair).width;
                const drawX = x + (this.fontSize - w) / 2;
                ctx.fillText(numPair, drawX, curY);
                curY += this.fontSize;
                i++;
                continue;
            }

            // Punctuation rotation (90 degrees clockwise)
            if (this.forceRotateRegex.test(char)) {
                ctx.save();
                ctx.translate(x + this.fontSize / 2, curY + this.fontSize / 2);
                ctx.rotate(Math.PI / 2);
                ctx.fillText(char, -this.fontSize / 2, -this.fontSize / 2);
                ctx.restore();
            } else {
                ctx.fillText(char, x, curY);
            }
            curY += this.fontSize;
        }
    }
}

window.TextRenderEngine = TextRenderEngine;
