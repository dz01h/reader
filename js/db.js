class ZenDB {
    constructor() {
        this.DB_NAME = 'ZenReaderDB';
        this.DB_VERSION = 2;
        this.STORE_NAME = 'books'; // stores complete book content
        this.META_STORE = 'bookMeta'; // stores metadata without text content for fast listing
    }

    initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(this.STORE_NAME)) {
                    db.createObjectStore(this.STORE_NAME, { keyPath: 'id' });
                } else if (e.oldVersion < 2) {
                    // For V1 to V2 upgrade, if books existed, recreate it with keyPath
                    db.deleteObjectStore(this.STORE_NAME);
                    db.createObjectStore(this.STORE_NAME, { keyPath: 'id' });
                }
                
                if (!db.objectStoreNames.contains(this.META_STORE)) {
                    db.createObjectStore(this.META_STORE, { keyPath: 'id' });
                }
            };
        });
    }

    async saveBook(book) {
        try {
            const db = await this.initDB();
            
            // First cleanup if we have >= 10 books
            await this._enforceLRU(db);

            return new Promise((resolve, reject) => {
                const tx = db.transaction([this.STORE_NAME, this.META_STORE], 'readwrite');
                const store = tx.objectStore(this.STORE_NAME);
                const metaStore = tx.objectStore(this.META_STORE);
                
                store.put({ 
                    id: book.id, 
                    filename: book.filename, 
                    content: book.content 
                });
                
                metaStore.put({
                    id: book.id,
                    filename: book.filename,
                    progress: book.progress,
                    timestamp: book.timestamp
                });

                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
        } catch (e) {
            console.error("IDB save error:", e);
        }
    }

    async _enforceLRU(db) {
        const metas = await this.getRecentBooks();
        if (metas && metas.length >= 10) {
            // Sort by timestamp descending
            metas.sort((a, b) => b.timestamp - a.timestamp);
            // Delete all books beyond the 9th, so we have room for the 10th
            for (let i = 9; i < metas.length; i++) {
                await this.deleteBook(metas[i].id);
            }
        }
    }

    async getRecentBooks() {
        try {
            const db = await this.initDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(this.META_STORE, 'readonly');
                const metaStore = tx.objectStore(this.META_STORE);
                const request = metaStore.getAll();
                request.onsuccess = () => {
                    const results = request.result || [];
                    // Sort by timestamp descending (newest first)
                    results.sort((a, b) => b.timestamp - a.timestamp);
                    resolve(results);
                };
                request.onerror = () => reject(request.error);
            });
        } catch (e) {
            console.error("IDB getRecentBooks error:", e);
            return [];
        }
    }

    async loadBook(id) {
        if (!id) return null;
        try {
            const db = await this.initDB();
            return new Promise((resolve, reject) => {
                if (!db.objectStoreNames.contains(this.STORE_NAME)) return resolve(null);
                const tx = db.transaction([this.STORE_NAME, this.META_STORE], 'readonly');
                const store = tx.objectStore(this.STORE_NAME);
                const metaStore = tx.objectStore(this.META_STORE);
                
                const request = store.get(id);
                const metaRequest = metaStore.get(id);
                
                tx.oncomplete = () => {
                    if (request.result && metaRequest.result) {
                        resolve({
                            id: request.result.id,
                            filename: request.result.filename,
                            content: request.result.content,
                            progress: metaRequest.result.progress,
                            timestamp: metaRequest.result.timestamp
                        });
                    } else {
                        resolve(null);
                    }
                };
                tx.onerror = () => reject(tx.error);
            });
        } catch (e) {
            console.error("IDB load error:", e);
            return null;
        }
    }

    async deleteBook(id) {
        if (!id) return;
        try {
            const db = await this.initDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction([this.STORE_NAME, this.META_STORE], 'readwrite');
                const store = tx.objectStore(this.STORE_NAME);
                const metaStore = tx.objectStore(this.META_STORE);
                store.delete(id);
                metaStore.delete(id);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
        } catch (e) {
            console.error("IDB delete error:", e);
        }
    }
}

window.ZenDB = ZenDB;
