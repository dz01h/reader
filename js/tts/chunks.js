class ZenTTSChunker {
    constructor(text, parent = null) {
        this.text = text;
        this.chunks = [];
        this.idx = 0;
        this.parent = parent;
    }

    get(i) {
        return this.chunks[i];
    }

    first() {
        return this.chunks[0];
    }

    last() {
        return this.chunks[this.chunks.length - 1];
    }

    next() {
        return this.chunks[this.idx++];
    }

    hasNext() {
        return this.idx < this.chunks.length;
    }

    append(text) {
        return new this.constructor(text, this);
    }
}

window.ZenTTSChunker = ZenTTSChunker;