class OPFSModule {
    constructor() {
        this.dirName = 'reader';
    }

    async getDir() {
        const root = await navigator.storage.getDirectory();
        return await root.getDirectoryHandle(this.dirName, { create: true });
    }

    async saveFile(filename, content) {
        try {
            const dir = await this.getDir();
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
        try {
            const dir = await this.getDir();
            const fileHandle = await dir.getFileHandle(filename);
            const file = await fileHandle.getFile();
            return await file.text();
        } catch (e) {
            console.error('OPFS loadFile error:', e);
            return null;
        }
    }

    async deleteFile(filename) {
        try {
            const dir = await this.getDir();
            await dir.removeEntry(filename);
            return true;
        } catch (e) {
            console.error('OPFS deleteFile error:', e);
            return false;
        }
    }

    async listFiles() {
        try {
            const dir = await this.getDir();
            const files = [];
            for await (const entry of dir.values()) {
                if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.txt')) {
                    const fileHandle = await dir.getFileHandle(entry.name);
                    const file = await fileHandle.getFile();
                    files.push({
                        name: entry.name,
                        lastModified: file.lastModified,
                        size: file.size
                    });
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
        try {
            const dir = await this.getDir();
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

window.ZenOPFS = new OPFSModule();
