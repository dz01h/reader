class OPFSModule {
    constructor() {
        this.dirName = 'reader';
    }

    isSupported() {
        return typeof navigator !== 'undefined' && 
               typeof navigator.storage !== 'undefined' && 
               typeof navigator.storage.getDirectory === 'function';
    }

    async getDir() {
        if (!this.isSupported()) return null;
        try {
            const root = await navigator.storage.getDirectory();
            return await root.getDirectoryHandle(this.dirName, { create: true });
        } catch (e) {
            console.warn('[OPFS] getDir error:', e);
            return null;
        }
    }

    async getCacheDir() {
        if (!this.isSupported()) return null;
        try {
            const root = await navigator.storage.getDirectory();
            const readerDir = await root.getDirectoryHandle(this.dirName, { create: true });
            return await readerDir.getDirectoryHandle('.cache', { create: true });
        } catch (e) {
            console.warn('[OPFS] getCacheDir error:', e);
            return null;
        }
    }

    async saveCacheFile(filename, content) {
        if (!this.isSupported()) return false;
        try {
            const dir = await this.getCacheDir();
            if (!dir) return false;
            const fileHandle = await dir.getFileHandle(filename, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(content);
            await writable.close();
            return true;
        } catch (e) {
            console.error('OPFS saveCacheFile error:', e);
            throw e;
        }
    }

    async loadCacheFile(filename) {
        if (!this.isSupported()) return null;
        try {
            const dir = await this.getCacheDir();
            if (!dir) return null;
            const fileHandle = await dir.getFileHandle(filename);
            const file = await fileHandle.getFile();
            return await file.text();
        } catch (e) {
            // Usually means file doesn't exist yet, which is normal for cache
            return null;
        }
    }

    async saveFile(filename, content) {
        if (!this.isSupported()) return false;
        try {
            const dir = await this.getDir();
            if (!dir) return false;
            const fileHandle = await dir.getFileHandle(filename, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(content);
            await writable.close();
            return true;
        } catch (e) {
            console.error('OPFS saveFile error:', e);
            throw e;
        }
    }

    async loadFile(filename) {
        if (!this.isSupported()) return null;
        try {
            const dir = await this.getDir();
            if (!dir) return null;
            const fileHandle = await dir.getFileHandle(filename);
            const file = await fileHandle.getFile();
            return await file.text();
        } catch (e) {
            console.error('OPFS loadFile error:', e);
            return null;
        }
    }

    async readFile(filename) {
        return await this.loadFile(filename);
    }

    async deleteFile(filename) {
        if (!this.isSupported()) return false;
        try {
            const dir = await this.getDir();
            if (!dir) return false;
            await dir.removeEntry(filename);
            return true;
        } catch (e) {
            console.error('OPFS deleteFile error:', e);
            return false;
        }
    }

    async listFiles() {
        if (!this.isSupported()) return [];
        try {
            const dir = await this.getDir();
            if (!dir) return [];
            const files = [];

            if (typeof dir.values === 'function') {
                for await (const entry of dir.values()) {
                    if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.txt')) {
                        try {
                            const file = await entry.getFile();
                            files.push({
                                name: entry.name,
                                lastModified: file.lastModified,
                                size: file.size
                            });
                        } catch (err) {
                            console.warn('[OPFS] Failed to read file handle for', entry.name, err);
                        }
                    }
                }
            } else if (typeof dir.entries === 'function' || dir[Symbol.asyncIterator]) {
                for await (const [name, entry] of dir) {
                    if (entry.kind === 'file' && name.toLowerCase().endsWith('.txt')) {
                        try {
                            const file = await entry.getFile();
                            files.push({
                                name: name,
                                lastModified: file.lastModified,
                                size: file.size
                            });
                        } catch (err) {
                            console.warn('[OPFS] Failed to read file entry for', name, err);
                        }
                    }
                }
            }

            // Sort by last updated descending
            files.sort((a, b) => b.lastModified - a.lastModified);
            return files;
        } catch (e) {
            console.error('OPFS listFiles error:', e);
            return [];
        }
    }

    async downloadFile(filename) {
        if (!this.isSupported()) return false;
        try {
            const dir = await this.getDir();
            if (!dir) return false;
            const fileHandle = await dir.getFileHandle(filename);
            const file = await fileHandle.getFile();
            
            // Trigger download
            const url = URL.createObjectURL(file);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            return true;
        } catch (e) {
            console.error('OPFS downloadFile error:', e);
            return false;
        }
    }
}

if (typeof window !== 'undefined') {
    window.ZenOPFS = new OPFSModule();
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { OPFSModule };
}
