/**
 * ZipHandler
 * Utility for parsing ZIP archives and extracting text files.
 * Returns extracted content to ExplorerPanel to unify document creation and event dispatch.
 */
class ZipHandler {
    constructor(app) {
        this.app = app;
    }

    /**
     * Process ZIP archive.
     * If single file: returns extracted { text, filename, isSingle: true }.
     * If multiple files: configures file-panel with in-memory zipSource for user selection and returns null.
     * @param {Blob|ArrayBuffer|Uint8Array} blobOrBuffer 
     * @param {string} zipName 
     * @returns {Promise<{ text: string, filename: string, isSingle: boolean }|null>}
     */
    async processZip(blobOrBuffer, zipName) {
        if (!window.JSZip) {
            throw new Error('未載入 JSZip 函式庫，無法解壓縮 ZIP 檔案');
        }

        if (this.app && typeof this.app.showToast === 'function') {
            this.app.showToast('正在解析 ZIP 內容...');
        }

        const zip = new window.JSZip();
        const contents = await zip.loadAsync(blobOrBuffer);
        const txtFiles = [];

        contents.forEach((relativePath, zipEntry) => {
            // Ignore Mac OSX metadata folders and directories
            if (!zipEntry.dir && relativePath.toLowerCase().endsWith('.txt') && !relativePath.includes('__MACOSX')) {
                txtFiles.push({
                    id: relativePath,
                    name: relativePath.split('/').pop(),
                    type: 'file',
                    zipEntry: zipEntry
                });
            }
        });

        if (txtFiles.length === 0) {
            if (this.app && typeof this.app.showToast === 'function') {
                this.app.showToast('ZIP 內找不到任何 .txt 檔案！');
            }
            throw new Error('ZIP 內找不到任何 .txt 檔案！');
        }

        if (txtFiles.length === 1) {
            const entry = txtFiles[0].zipEntry;
            const text = await this.extractEntryText(entry);
            const finalName = `[${zipName}] ${txtFiles[0].name}`;
            return {
                text: text,
                filename: finalName,
                isSingle: true
            };
        } else {
            // Multiple TXT files inside ZIP -> Switch file-panel to show ZIP contents
            const filePanel = document.querySelector('file-panel');
            if (filePanel) {
                const self = this;
                const zipSource = {
                    id: 'zip',
                    name: `📦 ${zipName}`,
                    path: [{ id: 'zip_root', name: zipName }],
                    canDelete: false,
                    async listFiles() {
                        return txtFiles.map(f => ({
                            id: f.id,
                            name: f.name,
                            type: 'file',
                            zipEntry: f.zipEntry
                        }));
                    },
                    async loadFile(item) {
                        const entry = item.zipEntry || txtFiles.find(f => f.id === item.id)?.zipEntry;
                        if (!entry) throw new Error('ZIP 項目未找到');
                        return await self.extractEntryText(entry);
                    },
                    async navigate(targetId) {
                        if (targetId === 'root') {
                            const defaultSource = (typeof FileSource !== 'undefined' && typeof FileSource.getInstance === 'function')
                                ? FileSource.getInstance()
                                : (window.OPFSFileSource ? new window.OPFSFileSource() : null);
                            filePanel.setSource(defaultSource);
                        }
                    }
                };
                filePanel.setSource(zipSource);
            }
            return null;
        }
    }

    /**
     * Extract and decode a zip entry into plain text string
     * @param {Object} zipEntry 
     * @returns {Promise<string>}
     */
    async extractEntryText(zipEntry) {
        const uint8array = await zipEntry.async('uint8array');
        let text = '';
        if (this.app && typeof this.app.decodeText === 'function') {
            text = this.app.decodeText(uint8array);
        } else {
            text = this.decodeText(uint8array);
        }

        if (this.app && typeof this.app.processExternalText === 'function') {
            text = await this.app.processExternalText(text);
        }
        return text;
    }

    /**
     * Fallback text decoder
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
}

if (typeof window !== 'undefined') {
    window.ZenZipHandler = ZipHandler;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ZipHandler };
}
