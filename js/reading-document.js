class ReadingDocument {
    constructor(text = "") {
        this.text = text;
        // Array of [startOffset, length] for each formatted line
        this.lines = [];
        // Array of { title, lineIndex, charOffset } for chapter bookmarks
        this.chapters = [];
    }

    /**
     * Set new raw text
     * @param {string} text 
     */
    setText(text) {
        this.text = text || "";
        this.lines = [];
        this.chapters = [];
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
        const [start, len] = this.lines[i];
        return this.text.substring(start, start + len);
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

        const startOffset = this.lines[validStart][0];
        const lastLine = this.lines[validEnd];
        const endOffset = lastLine[0] + lastLine[1];

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

    /**
     * Get reading progress ratio (0.0 ~ 1.0) at line i
     * @param {number} lineIndex 
     * @returns {number}
     */
    getLineProgress(lineIndex) {
        if (this.lines.length <= 1) return 0;
        return Math.max(0, Math.min(1, lineIndex / (this.lines.length - 1)));
    }

    /**
     * Find closest line index given a progress ratio (0.0 ~ 1.0)
     * @param {number} progress 
     * @returns {number}
     */
    findLineByProgress(progress) {
        if (this.lines.length <= 1) return 0;
        const target = Math.round(progress * (this.lines.length - 1));
        return Math.max(0, Math.min(target, this.lines.length - 1));
    }
}

window.ReadingDocument = ReadingDocument;
