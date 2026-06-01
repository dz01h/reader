class ZenBook {
    constructor(filename, content = '', progress = 0, timestamp = Date.now(), id = null) {
        this.filename = filename;
        this.content = content;
        this.progress = progress;
        this.timestamp = timestamp;
        // Generate an ID if not provided. Safe for local IDB.
        this.id = id || btoa(encodeURIComponent(filename)).replace(/=/g, '') + '_' + Date.now();
    }

    async saveToDB(db) {
        this.timestamp = Date.now(); // Update timestamp on save
        await db.saveBook(this);
    }

    async deleteFromDB(db) {
        await db.deleteBook(this.id);
        
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

    saveProgress(progress) {
        if (progress !== undefined) {
            this.progress = progress;
        }
        this.timestamp = Date.now();

        try {
            const STATE_KEY = 'zen_reader_state';
            const savedState = localStorage.getItem(STATE_KEY);
            let state = savedState ? JSON.parse(savedState) : {};
            if (!state.positions) state.positions = {};
            state.positions[this.filename] = { progress: this.progress, ts: this.timestamp };
            localStorage.setItem(STATE_KEY, JSON.stringify(state));
        } catch (e) {
            console.error("Failed to save progress", e);
        }
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

    static async getRecentBooks(db) {
        return await db.getRecentBooks();
    }

    static async loadBook(db, id) {
        if (!db || !id) return null;
        const bookData = await db.loadBook(id);
        if (bookData && bookData.filename && bookData.content) {
            const book = new ZenBook(
                bookData.filename, 
                bookData.content, 
                bookData.progress || 0, 
                bookData.timestamp || Date.now(), 
                bookData.id
            );
            book.loadProgress();
            return book;
        }
        return null;
    }
}

window.ZenBook = ZenBook;
