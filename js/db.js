class ZenDB {
    constructor() {
        this.DB_NAME = 'ZenReaderDB';
        this.DB_VERSION = 1;
        this.STORE_NAME = 'books';
    }

    initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(this.STORE_NAME)) {
                    db.createObjectStore(this.STORE_NAME);
                }
            };
        });
    }

    async saveBook(filename, content) {
        try {
            const db = await this.initDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(this.STORE_NAME, 'readwrite');
                const store = tx.objectStore(this.STORE_NAME);
                store.put({ filename, content }, 'currentBook');
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
        } catch (e) {
            console.error("IDB save error:", e);
        }
    }

    async loadBook() {
        try {
            const db = await this.initDB();
            return new Promise((resolve, reject) => {
                if (!db.objectStoreNames.contains(this.STORE_NAME)) return resolve(null);
                const tx = db.transaction(this.STORE_NAME, 'readonly');
                const store = tx.objectStore(this.STORE_NAME);
                const request = store.get('currentBook');
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        } catch (e) {
            console.error("IDB load error:", e);
            return null;
        }
    }

    async deleteBook() {
        try {
            const db = await this.initDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(this.STORE_NAME, 'readwrite');
                const store = tx.objectStore(this.STORE_NAME);
                const request = store.delete('currentBook');
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        } catch (e) {
            console.error("IDB delete error:", e);
        }
    }
}

window.ZenDB = ZenDB;
