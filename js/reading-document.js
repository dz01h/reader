class ReadingDocument {

    constructor(text = "") {
        this.text = text || "";
        // Array of [startOffset, length] for each formatted line
        this.lines = [];
        // Array of { title, lineIndex, charOffset } for chapter bookmarks
        this.chapters = [];

        // Reading Progress State (Single Source of Truth)
        this.progress = 0.0; // 0.0 ~ 1.0
        this.timestamp = Date.now();
    }

    /**
     * Set new raw text and reset state
     * @param {string} text 
     */
    setText(text) {
        this.text = text || "";
        this.lines = [];
        this.chapters = [];
        this.progress = 0.0;
        this.timestamp = Date.now();
    }

    /**
     * Get sliding window raw lines around current progress for fast on-demand rendering
     * @param {number} lineNumber Number of raw lines to fetch before and after progress anchor
     * @returns {{ progress: number, lines: Array<string>, lineIndexs: Array<number>, zeroIndex: number, startCharOffset: number, totalLength: number }}
     */
    getRenderData(lineNumber = 50) {
        const totalLen = this.text.length;
        if (totalLen === 0) {
            return { progress: this.progress, lines: [], lineIndexs: [], zeroIndex: 0, startCharOffset: 0, totalLength: 0 };
        }

        const targetOffset = Math.max(0, Math.min(totalLen - 1, Math.round(this.progress * totalLen)));

        // 1. Find the raw line boundaries containing targetOffset
        let anchorStart = this.text.lastIndexOf('\n', targetOffset - 1);
        anchorStart = anchorStart === -1 ? 0 : anchorStart + 1;

        let anchorEnd = this.text.indexOf('\n', targetOffset);
        anchorEnd = anchorEnd === -1 ? totalLen : anchorEnd;

        // 2. Search backward for up to lineNumber lines
        const prevStarts = [];
        let curr = anchorStart > 0 ? anchorStart - 1 : 0;
        while (curr > 0 && prevStarts.length < lineNumber) {
            const prevNewline = this.text.lastIndexOf('\n', curr - 1);
            if (prevNewline === -1) {
                prevStarts.unshift(0);
                break;
            } else {
                prevStarts.unshift(prevNewline + 1);
                curr = prevNewline;
            }
        }

        // 3. Search forward for up to lineNumber lines
        const nextEnds = [];
        let currEnd = anchorEnd;
        while (currEnd < totalLen && nextEnds.length < lineNumber) {
            const nextNewline = this.text.indexOf('\n', currEnd + 1);
            if (nextNewline === -1) {
                nextEnds.push(totalLen);
                break;
            } else {
                nextEnds.push(nextNewline);
                currEnd = nextNewline;
            }
        }

        const windowStart = prevStarts.length > 0 ? prevStarts[0] : anchorStart;
        const windowEnd = nextEnds.length > 0 ? nextEnds[nextEnds.length - 1] : anchorEnd;

        const windowText = this.text.substring(windowStart, windowEnd);
        const rawLines = windowText.split('\n').map(l => l.endsWith('\r') ? l.slice(0, -1) : l);
        const zeroIndex = prevStarts.length;

        // Compute starting strpos for each raw line
        const lineIndexs = [];
        let charPos = windowStart;
        for (let i = 0; i < rawLines.length; i++) {
            lineIndexs.push(charPos);
            const nlIndex = this.text.indexOf('\n', charPos);
            if (nlIndex !== -1 && nlIndex < windowEnd) {
                charPos = nlIndex + 1;
            } else {
                charPos = windowEnd;
            }
        }

        return {
            progress: this.progress,
            lines: rawLines,
            lineIndexs: lineIndexs,
            zeroIndex: zeroIndex,
            startCharOffset: windowStart,
            totalLength: totalLen
        };
    }

    /**
     * Format text using the provided TextRenderEngine instance
     * @param {TextRenderEngine} engine 
     */
    format(engine) {
        if (!this.text || !engine) {
            this.lines = [];
            this.chapters = [];
            return;
        }
        const result = engine.formatText(this.text);
        this.lines = result.lines || [];
        this.chapters = result.chapters || [];
    }

    /**
     * Get substring for line index i
     * @param {number} i 
     * @returns {string}
     */
    getLine(i) {
        if (i < 0 || i >= this.lines.length) return "";
        const line = this.lines[i];
        if (typeof line === 'string') return line;
        if (Array.isArray(line)) return this.text.substring(line[0], line[0] + line[1]);
        return line?.text ?? "";
    }

    /**
     * Get concatenated text across a line range [startLine, endLine] (inclusive)
     * Useful for TTS chunking, page text extraction, and copying
     * @param {number} startLine 
     * @param {number} endLine 
     * @returns {string}
     */
    getLineRange(startLine, endLine) {
        if (this.lines.length === 0) return "";
        const validStart = Math.max(0, Math.min(startLine, this.lines.length - 1));
        const validEnd = Math.max(0, Math.min(endLine, this.lines.length - 1));
        if (validStart > validEnd) return "";

        const startLineItem = this.lines[validStart];
        if (typeof startLineItem === 'string') {
            let res = "";
            for (let i = validStart; i <= validEnd; i++) {
                res += (this.lines[i] || "") + (i < validEnd ? "\n" : "");
            }
            return res;
        }

        const startOffset = Array.isArray(startLineItem) ? startLineItem[0] : (startLineItem.start || 0);
        const lastLine = this.lines[validEnd];
        const endOffset = Array.isArray(lastLine) ? (lastLine[0] + lastLine[1]) : ((lastLine.start || 0) + (lastLine.length || 0));

        return this.text.substring(startOffset, endOffset);
    }

    /**
     * Get total line count
     * @returns {number}
     */
    getLineCount() {
        return this.lines.length;
    }

    /**
     * Find the line index corresponding to a character offset (Binary search)
     * @param {number} charOffset 
     * @returns {number}
     */
    findLineByCharOffset(charOffset) {
        if (this.lines.length === 0) return 0;
        let low = 0;
        let high = this.lines.length - 1;

        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            const [start, len] = this.lines[mid];
            if (charOffset < start) {
                high = mid - 1;
            } else if (charOffset >= start + len) {
                low = mid + 1;
            } else {
                return mid;
            }
        }
        return Math.max(0, Math.min(low, this.lines.length - 1));
    }

    // ==========================================
    // Reading Progress Management (0.0 ~ 1.0)
    // ==========================================

    /**
     * Directly set reading progress ratio (0.0 ~ 1.0)
     * @param {number} prog Progress ratio between 0.0 and 1.0
     * @param {number} [timestamp] Optional timestamp in ms, defaults to Date.now()
     */
    setProgress(prog, timestamp = Date.now()) {
        const clamped = Math.max(0, Math.min(1, typeof prog === 'number' ? prog : 0));
        this.progress = clamped;
        this.timestamp = timestamp || Date.now();
    }

    /**
     * Update progress from a specific visible line index
     * Uses character offset for cross-device/cross-resolution invariant precision
     * @param {number} lineIndex 
     * @param {number} [timestamp] 
     */
    setProgressByLine(lineIndex, timestamp = Date.now()) {
        if (this.lines.length === 0 || this.text.length === 0) {
            this.setProgress(0, timestamp);
            return;
        }
        const validIndex = Math.max(0, Math.min(lineIndex, this.lines.length - 1));
        const [charOffset] = this.lines[validIndex];
        const prog = charOffset / this.text.length;
        this.setProgress(prog, timestamp);
    }

    /**
     * Get reading progress ratio (0.0 ~ 1.0) at line index
     * @param {number} lineIndex 
     * @returns {number}
     */
    getProgressByLine(lineIndex) {
        if (this.lines.length === 0 || this.text.length === 0) return 0;
        const validIndex = Math.max(0, Math.min(lineIndex, this.lines.length - 1));
        const [charOffset] = this.lines[validIndex];
        return charOffset / this.text.length;
    }

    /**
     * Find target line index corresponding to a progress ratio (0.0 ~ 1.0)
     * @param {number} [prog] Defaults to this.progress
     * @returns {number} Line index
     */
    getLineByProgress(prog = this.progress) {
        if (this.lines.length === 0 || this.text.length === 0) return 0;
        const targetCharOffset = Math.round(prog * this.text.length);
        return this.findLineByCharOffset(targetCharOffset);
    }

    /**
     * Get the character offset corresponding to a progress ratio
     * @param {number} [prog] Defaults to this.progress
     * @returns {number}
     */
    getCharOffsetByProgress(prog = this.progress) {
        if (!this.text || this.text.length === 0) return 0;
        return Math.max(0, Math.min(this.text.length, Math.round(prog * this.text.length)));
    }

    /**
     * Get current chapter info corresponding to a progress ratio
     * @param {number} [prog] Defaults to this.progress
     * @returns {{ title: string, lineIndex: number, charOffset: number } | null}
     */
    getCurrentChapter(prog = this.progress) {
        if (!this.chapters || this.chapters.length === 0) return null;
        const targetLine = this.getLineByProgress(prog);
        let currentChapter = this.chapters[0];

        for (let i = 0; i < this.chapters.length; i++) {
            const ch = this.chapters[i];
            if (ch.lineIndex <= targetLine) {
                currentChapter = ch;
            } else {
                break;
            }
        }
        return currentChapter;
    }

}

window.ReadingDocument = ReadingDocument;
