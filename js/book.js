class ZenBook {
    constructor(filename, content = '', progress = 0, timestamp = Date.now()) {
        this.filename = filename;
        this.content = content;
        this.progress = progress;
        this.timestamp = timestamp;
    }

    loadProgress() {
        try {
            const savedState = localStorage.getItem('zen_reader_state');
            if (savedState) {
                const state = JSON.parse(savedState);
                if (state.positions && state.positions[this.filename]) {
                    this.progress = state.positions[this.filename].progress || 0;
                    this.timestamp = state.positions[this.filename].ts || Date.now();
                }
            }
        } catch (e) {
            console.error("Failed to load progress", e);
        }
    }

    saveProgress(progress) {
        if (progress !== undefined) {
            this.progress = progress;
        }
        this.timestamp = Date.now();

        try {
            const STATE_KEY = 'zen_reader_state';
            const savedState = localStorage.getItem(STATE_KEY);
            let state = savedState ? JSON.parse(savedState) : {};
            state.positions = { 
                [this.filename]: { progress: this.progress, ts: this.timestamp } 
            };
            localStorage.setItem(STATE_KEY, JSON.stringify(state));
        } catch (e) {
            console.error("Failed to save progress", e);
        }
    }

    async saveToDB(db) {
        if (!db) return;
        await db.saveBook(this.filename, this.content);
        this.saveProgress();
    }

    async deleteFromDB(db) {
        if (!db) return;
        await db.deleteBook();
        
        // Also clear progress from localStorage
        try {
            const STATE_KEY = 'zen_reader_state';
            const savedState = localStorage.getItem(STATE_KEY);
            if (savedState) {
                let state = JSON.parse(savedState);
                if (state.positions) {
                    delete state.positions[this.filename];
                    localStorage.setItem(STATE_KEY, JSON.stringify(state));
                }
            }
        } catch (e) {}
    }

    static async loadCurrentBook(db) {
        if (!db) return null;
        const bookData = await db.loadBook();
        if (bookData && bookData.filename && bookData.content) {
            const book = new ZenBook(bookData.filename, bookData.content);
            book.loadProgress();
            return book;
        }
        return null;
    }
}

window.ZenBook = ZenBook;
