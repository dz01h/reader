class ReadingDocument {
    static TOC_REGEX = /^\s*(第[零一二三四五六七八九十百千萬0-9０-９]+[章回節卷]|Chapter\s*[0-9]+|正文|楔子|前言|番外)/i;

    constructor(text = "", title = "", source = "") {
        this.text = text || "";
        this.title = title || "";
        this.source = source || "";
        this.chapters = [];
        this.progress = 0.0; // 0.0 ~ 1.0 (Single Source of Truth)
        this.timestamp = Date.now();
        this._chaptersMap = null;
    }

    /**
     * Check if a given line is a chapter title
     * @param {string} line 
     * @returns {boolean}
     */
    static isChapterTitle(line) {
        if (!line) return false;
        const trimmed = line.trim();
        return trimmed.length > 0 && trimmed.length < 50 && ReadingDocument.TOC_REGEX.test(trimmed);
    }

    /**
     * Set new raw text and reset reading state
     * @param {string} text 
     * @param {string} [title]
     * @param {string} [source]
     */
    setText(text, title = this.title, source = this.source) {
        this.text = text || "";
        this.title = title || "";
        this.source = source || "";
        this.chapters = [];
        this._chaptersMap = null;
        this.progress = 0.0;
        this.timestamp = Date.now();
    }

    /**
     * Total character count
     */
    get totalLength() {
        return this.text.length;
    }

    /**
     * Get all chapters as a mapping of { [chapterTitle: string]: progress<double> }
     * @returns {Record<string, number>}
     */
    getChapters() {
        if (this._chaptersMap) {
            return this._chaptersMap;
        }

        const map = {};
        this.chapters = [];
        const totalLen = this.text.length;

        if (totalLen === 0) {
            this._chaptersMap = map;
            return map;
        }

        const lines = this.text.split('\n');
        let charIndex = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            if (ReadingDocument.isChapterTitle(trimmed)) {
                const prog = charIndex / totalLen;
                map[trimmed] = prog;
                this.chapters.push({
                    title: trimmed,
                    progress: prog,
                    charOffset: charIndex
                });
            }
            charIndex += line.length + 1; // +1 for '\n'
        }

        this._chaptersMap = map;
        return map;
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

        // 1. Find raw line boundaries containing targetOffset
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

        // Compute starting character index (strpos) for each raw line
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
     * Get character offset in document corresponding to progress ratio
     * @param {number} [prog] Defaults to this.progress
     * @returns {number}
     */
    getCharOffset(prog = this.progress) {
        if (!this.text || this.text.length === 0) return 0;
        return Math.max(0, Math.min(this.text.length, Math.round(prog * this.text.length)));
    }

    /**
     * Get current chapter info corresponding to a progress ratio
     * @param {number} [prog] Defaults to this.progress
     * @returns {{ title: string, progress: number, charOffset: number } | null}
     */
    getCurrentChapter(prog = this.progress) {
        if (!this._chaptersMap) {
            this.getChapters();
        }
        if (!this.chapters || this.chapters.length === 0) return null;

        const targetOffset = this.getCharOffset(prog);
        let currentChapter = this.chapters[0];

        for (let i = 0; i < this.chapters.length; i++) {
            const ch = this.chapters[i];
            if (ch.charOffset <= targetOffset) {
                currentChapter = ch;
            } else {
                break;
            }
        }
        return currentChapter;
    }
}

if (typeof window !== 'undefined') {
    window.ReadingDocument = ReadingDocument;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ReadingDocument };
}
