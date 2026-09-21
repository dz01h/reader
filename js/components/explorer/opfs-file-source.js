/**
 * OPFSFileSource
 * Lists books and text files already loaded and stored in the Origin Private File System (OPFS).
 */
class OPFSFileSource extends (window.FileSource || class {}) {
    constructor() {
        super('opfs', '已存書籍');
        OPFSFileSource.bindGlobalEvents();
    }

    /**
     * Bind global listener for ReadingOperation to automatically persist read documents
     */
    static bindGlobalEvents() {
        if (typeof document === 'undefined' || !document.body || document.body._opfsGlobalBound) return;
        document.body._opfsGlobalBound = true;

        document.body.addEventListener('ReadingOperation', async (e) => {
            if (e.detail && e.detail.action === 'read' && Array.isArray(e.detail.params) && e.detail.params[0]) {
                const doc = e.detail.params[0];
                await OPFSFileSource.handleReadDocument(doc);
            }
        });
    }

    /**
     * Automatically persist an incoming ReadingDocument into OPFS if it's from an external source
     * @param {ReadingDocument} doc 
     */
    static async handleReadDocument(doc) {
        if (!doc || !doc.text || !window.ZenOPFS) return;
        // Do not re-save documents already originating from OPFS
        if (doc.source === 'opfs') return;

        const filename = doc.title;
        if (!filename || filename === 'document.txt') return;

        try {
            await window.ZenOPFS.saveFile(filename, doc.text);
            console.log(`[OPFSFileSource] 已透過 read(doc) 自動存入 OPFS: ${filename}`);

            if (window._app && typeof window._app.showToast === 'function') {
                window._app.showToast(`已加入離線書庫: ${filename}`);
            }

            // Notify file panels to refresh if they are currently displaying OPFS
            if (typeof document !== 'undefined' && document.body) {
                const event = typeof CustomEvent !== 'undefined' 
                    ? new CustomEvent('fileSourceChanged', { detail: { source: 'opfs', filename: filename } })
                    : { type: 'fileSourceChanged', detail: { source: 'opfs', filename: filename } };
                document.body.dispatchEvent(event.type || 'fileSourceChanged', event);
            }
        } catch (err) {
            console.warn('[OPFSFileSource] 自動存入 OPFS 失敗:', err);
        }
    }

    /**
     * List all text files stored in OPFS along with their saved reading progress
     * @returns {Promise<Array<{ id: string, name: string, type: 'file', size: number, lastModified: number, progress: number, progressTimestamp: number }>>}
     */
    async listFiles() {
        if (!window.ZenOPFS) {
            console.warn('ZenOPFS module not found');
            return [];
        }

        try {
            const rawFiles = await window.ZenOPFS.listFiles();

            // Retrieve reading progress records from localStorage
            let positions = {};
            try {
                const stateKey = (window.ZenReaderApp && window.ZenReaderApp.STATE_KEY) || 'zen_reader_state';
                const savedState = localStorage.getItem(stateKey) || localStorage.getItem('reader_status');
                if (savedState) {
                    const parsed = JSON.parse(savedState);
                    if (parsed && typeof parsed.positions === 'object') {
                        positions = parsed.positions;
                    }
                }
            } catch (err) {
                console.error('Failed to read reading progress positions:', err);
            }

            const items = rawFiles.map(file => {
                const posData = positions[file.name];
                const progress = posData && typeof posData.progress === 'number' ? posData.progress : 0;
                const progressTimestamp = posData && posData.ts ? posData.ts : file.lastModified;

                return {
                    id: file.name,
                    name: file.name,
                    type: 'file',
                    size: file.size || 0,
                    lastModified: file.lastModified || Date.now(),
                    progress: Math.max(0, Math.min(1, progress)),
                    progressTimestamp: progressTimestamp
                };
            });

            // Sort by most recently accessed / read, then last modified
            items.sort((a, b) => (b.progressTimestamp || b.lastModified) - (a.progressTimestamp || a.lastModified));
            return items;
        } catch (err) {
            console.error('OPFSFileSource listFiles error:', err);
            return [];
        }
    }

    /**
     * Load document text from OPFS
     * @param {Object|string} fileItem
     * @returns {Promise<string|null>}
     */
    async loadFile(fileItem) {
        if (!window.ZenOPFS) throw new Error('ZenOPFS module is not available');
        const filename = typeof fileItem === 'string' ? fileItem : (fileItem.name || fileItem.id);
        return await window.ZenOPFS.loadFile(filename);
    }

    /**
     * Delete document from OPFS and clean up saved progress
     * @param {Object|string} fileItem
     * @returns {Promise<boolean>}
     */
    async deleteFile(fileItem) {
        if (!window.ZenOPFS) return false;
        const filename = typeof fileItem === 'string' ? fileItem : (fileItem.name || fileItem.id);
        const success = await window.ZenOPFS.deleteFile(filename);

        // Remove reading progress entry from storage
        try {
            const stateKey = (window.ZenReaderApp && window.ZenReaderApp.STATE_KEY) || 'zen_reader_state';
            const savedState = localStorage.getItem(stateKey) || localStorage.getItem('reader_status');
            if (savedState) {
                const state = JSON.parse(savedState);
                if (state && state.positions && state.positions[filename]) {
                    delete state.positions[filename];
                    localStorage.setItem(stateKey, JSON.stringify(state));
                }
            }
        } catch (err) {
            console.error('Failed to cleanup reading progress on file delete:', err);
        }

        return success;
    }

    /**
     * Save a new file into OPFS
     * @param {string} filename
     * @param {string} content
     * @returns {Promise<boolean>}
     */
    async saveFile(filename, content) {
        if (!window.ZenOPFS) return false;
        return await window.ZenOPFS.saveFile(filename, content);
    }
}

if (typeof window !== 'undefined') {
    window.OPFSFileSource = OPFSFileSource;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { OPFSFileSource };
}

customElements.define('opfs-file-source', OPFSFileSource);
