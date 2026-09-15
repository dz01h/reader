class ReadingDocument {
    constructor(text = "") {
        this.text = text || "";
        this.chapters = [];
        this.progress = 0.0; // 0.0 ~ 1.0 (Single Source of Truth)
        this.timestamp = Date.now();
    }

    /**
     * Set new raw text and reset reading state
     * @param {string} text 
     */
    setText(text) {
        this.text = text || "";
        this.chapters = [];
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
     * @returns {{ title: string, charOffset: number } | null}
     */
    getCurrentChapter(prog = this.progress) {
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

window.ReadingDocument = ReadingDocument;
