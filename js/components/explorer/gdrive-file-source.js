/**
 * GDriveFileSource
 * Lists and downloads books/text files stored in Google Drive.
 * Extends FileSource component.
 */
class GDriveFileSource extends (window.FileSource || class {}) {
    constructor() {
        super('gdrive', 'Google 雲端硬碟');
        this.canDelete = false;
        GDriveFileSource.bindGlobalEvents();
    }

    initComponent() {
        super.initComponent();
        if (!this.title) {
            this.title = '由 Google Drive 載入';
        }
    }

    /**
     * Bind global listener for GoogleApiReady to refresh file list if currently displaying GDrive
     */
    static bindGlobalEvents() {
        if (typeof document === 'undefined' || !document.body || document.body._gdriveSourceGlobalBound) return;
        document.body._gdriveSourceGlobalBound = true;

        document.body.addEventListener('GoogleApiReady', (e) => {
            const token = e.detail?.accessToken || e.detail?.token || null;
            const sources = document.querySelectorAll('gdrive-file-source');
            sources.forEach(s => { s.accessToken = token; });

            const filePanel = document.querySelector('file-panel');
            if (filePanel && filePanel.source && filePanel.source.id === 'gdrive') {
                filePanel.refresh();
            }
        });
    }

    /**
     * Helper to get GoogleAuthHelper instance
     */
    getAuthHelper() {
        return window.GoogleAuthHelper || null;
    }

    /**
     * Retrieve valid access token via google-get-token action
     * @returns {Promise<string|null>}
     */
    async getAccessToken() {
        const helper = this.getAuthHelper();

        // 1. Check if stored token is currently valid
        if (helper && typeof helper.getStoredGoogleToken === 'function') {
            const token = helper.getStoredGoogleToken();
            if (token) {
                this.accessToken = token;
                return token;
            }
        }

        // 2. Request token through 'google-get-token' action
        if (helper && typeof helper.requestGoogleToken === 'function') {
            const token = await helper.requestGoogleToken();
            if (token) {
                this.accessToken = token;
                return token;
            }
        }

        return this.accessToken || null;
    }

    /**
     * List files and folders in the current Google Drive path
     * @returns {Promise<Array<{ id: string, name: string, type: 'file'|'folder', size?: number, lastModified?: number, progress?: number, progressTimestamp?: number, mimeType?: string }>>}
     */
    async listFiles() {
        const token = await this.getAccessToken();
        if (!token) {
            if (window._app && typeof window._app.showToast === 'function') {
                window._app.showToast('尚未登入 Google 帳號，請至設定中進行登入');
            }
            return [];
        }

        const currentFolderId = this.path && this.path.length > 0 ? this.path[this.path.length - 1].id : 'root';

        try {
            const mimeFilter = "(mimeType='application/vnd.google-apps.folder' or mimeType='text/plain' or mimeType='application/zip' or name contains '.txt' or name contains '.zip')";
            let query = '';

            if (currentFolderId === 'virtual_shared') {
                query = encodeURIComponent(`sharedWithMe = true and trashed = false and ${mimeFilter}`);
            } else {
                query = encodeURIComponent(`trashed = false and '${currentFolderId}' in parents and ${mimeFilter}`);
            }

            const url = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,mimeType,size,modifiedTime)&pageSize=1000&includeItemsFromAllDrives=true&supportsAllDrives=true`;

            const res = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!res.ok) {
                if (res.status === 401) {
                    console.warn('[GDriveFileSource] Token expired (401), attempting background refresh...');
                    localStorage.removeItem('gdrive_auth');
                    if (window._app) window._app.gdriveToken = null;
                    const newToken = await this.getAccessToken();
                    if (newToken) {
                        return this.listFiles();
                    }
                }
                throw new Error(`Google Drive API error (${res.status})`);
            }

            const data = await res.json();

            // Load saved reading progress from storage to match files
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
            } catch (_) {}

            let items = (data.files || []).map(f => {
                const isFolder = f.mimeType === 'application/vnd.google-apps.folder';
                const posData = positions[f.name] || positions[f.id];
                const progress = posData && typeof posData.progress === 'number' ? posData.progress : 0;
                const progressTimestamp = posData && posData.ts ? posData.ts : (f.modifiedTime ? new Date(f.modifiedTime).getTime() : 0);

                return {
                    id: f.id,
                    name: f.name,
                    type: isFolder ? 'folder' : 'file',
                    size: f.size ? Number(f.size) : 0,
                    lastModified: f.modifiedTime ? new Date(f.modifiedTime).getTime() : Date.now(),
                    progress: Math.max(0, Math.min(1, progress)),
                    progressTimestamp: progressTimestamp,
                    mimeType: f.mimeType
                };
            });

            // Inject Virtual 'Shared with me' folder if at root
            if (currentFolderId === 'root') {
                items.unshift({
                    id: 'virtual_shared',
                    name: '🤝 與我共用 (Shared with me)',
                    type: 'folder',
                    mimeType: 'application/vnd.google-apps.folder',
                    size: 0,
                    lastModified: Date.now(),
                    progress: 0,
                    progressTimestamp: 0
                });
            }

            return items;
        } catch (err) {
            console.error('[GDriveFileSource] listFiles failed:', err);
            if (window._app && typeof window._app.showToast === 'function') {
                window._app.showToast('無法取得 Google Drive 檔案清單');
            }
            return [];
        }
    }

    /**
     * Download and load file content from Google Drive
     * @param {Object|string} fileItem
     * @returns {Promise<string|Blob|Uint8Array>}
     */
    async loadFile(fileItem) {
        const fileId = typeof fileItem === 'string' ? fileItem : (fileItem.id || fileItem.name);
        const fileName = typeof fileItem === 'object' ? (fileItem.name || fileId) : fileId;
        const mimeType = typeof fileItem === 'object' ? fileItem.mimeType : '';

        const token = await this.getAccessToken();
        if (!token) throw new Error('未登入 Google Drive，無法下載檔案');

        if (window._app && typeof window._app.showToast === 'function') {
            window._app.showToast(`正在從 Google Drive 下載「${fileName}」...`, 0);
        }

        const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error(`Google Drive 下載失敗: HTTP ${response.status}`);
        }

        const contentLength = response.headers.get('content-length');
        const total = contentLength ? parseInt(contentLength, 10) : 0;
        let loaded = 0;

        const reader = response.body?.getReader();
        if (!reader) {
            const arrayBuffer = await response.arrayBuffer();
            return this.processDownloadedData(new Uint8Array(arrayBuffer), fileName, mimeType);
        }

        const chunks = [];
        let lastUpdate = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            chunks.push(value);
            loaded += value.length;

            const now = Date.now();
            if (now - lastUpdate > 100) {
                lastUpdate = now;
                if (window._app && typeof window._app.showToast === 'function') {
                    if (total) {
                        const percent = Math.round((loaded / total) * 100);
                        window._app.showToast(`下載中... ${percent}%`, 0);
                    } else {
                        const mb = (loaded / 1024 / 1024).toFixed(2);
                        window._app.showToast(`下載中... ${mb} MB`, 0);
                    }
                }
            }
        }

        if (window._app && typeof window._app.showToast === 'function') {
            window._app.showToast('處理中...', 0);
        }

        // Combine chunks
        const mergedArray = new Uint8Array(loaded);
        let offset = 0;
        for (let chunk of chunks) {
            mergedArray.set(chunk, offset);
            offset += chunk.length;
        }

        return await this.processDownloadedData(mergedArray, fileName, mimeType);
    }

    /**
     * Process downloaded binary into text string or ZIP Blob
     * @param {Uint8Array} uint8Array 
     * @param {string} fileName 
     * @param {string} mimeType 
     * @returns {Promise<string|Blob>}
     */
    async processDownloadedData(uint8Array, fileName, mimeType) {
        if (fileName.toLowerCase().endsWith('.zip') || mimeType === 'application/zip') {
            return new Blob([uint8Array], { type: 'application/zip' });
        }

        let text = '';
        if (window._app && typeof window._app.decodeText === 'function') {
            text = window._app.decodeText(uint8Array);
        } else {
            text = this.decodeText(uint8Array);
        }

        if (window._app && typeof window._app.processExternalText === 'function') {
            text = await window._app.processExternalText(text);
        }

        return text;
    }

    /**
     * Text decoder with fallback
     * @param {Uint8Array} uint8array 
     * @returns {string}
     */
    decodeText(uint8array) {
        if (uint8array.length >= 2) {
            if (uint8array[0] === 0xFF && uint8array[1] === 0xFE) return new TextDecoder('utf-16le').decode(uint8array);
            if (uint8array[0] === 0xFE && uint8array[1] === 0xFF) return new TextDecoder('utf-16be').decode(uint8array);
        }
        if (uint8array.length >= 3 && uint8array[0] === 0xEF && uint8array[1] === 0xBB && uint8array[2] === 0xBF) {
            return new TextDecoder('utf-8').decode(uint8array);
        }
        try {
            return new TextDecoder('utf-8', { fatal: true }).decode(uint8array);
        } catch (_) {
            try {
                return new TextDecoder('big5', { fatal: true }).decode(uint8array);
            } catch (_) {
                return new TextDecoder('big5').decode(uint8array);
            }
        }
    }

    /**
     * Delete file from Google Drive
     * @param {Object|string} fileItem
     * @returns {Promise<boolean>}
     */
    async deleteFile(fileItem) {
        const fileId = typeof fileItem === 'string' ? fileItem : fileItem.id;
        if (!fileId) return false;

        const token = await this.getAccessToken();
        if (!token) return false;

        try {
            const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            return res.ok;
        } catch (err) {
            console.error('[GDriveFileSource] deleteFile failed:', err);
            return false;
        }
    }
}

if (typeof window !== 'undefined') {
    window.GDriveFileSource = GDriveFileSource;
    customElements.define('gdrive-file-source', GDriveFileSource);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { GDriveFileSource };
}
