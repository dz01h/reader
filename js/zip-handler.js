class ZipHandler {
    constructor(app) {
        this.app = app;
    }

    async processZip(blobOrFile, zipName) {
        if (!window.JSZip) {
            this.app.showToast(this.app.i18n ? this.app.i18n.t('gdriveZipDev') || '無 JSZip 函式庫' : '缺少組件');
            return;
        }

        this.app.showToast('正在解析 ZIP 內容...');
        const zip = new JSZip();
        try {
            const contents = await zip.loadAsync(blobOrFile);
            const txtFiles = [];
            
            contents.forEach((relativePath, zipEntry) => {
                // MacOS zip files often have __MACOSX resource forks which are junk
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
                this.app.showToast('ZIP 內找不到任何 .txt 檔案！');
                return;
            }

            if (txtFiles.length === 1) {
                // Auto load the only file
                await this.extractAndLoad(zipName, txtFiles[0].name, txtFiles[0].zipEntry);
            } else {
                // Leverage our File Explorer!
                const title = `📦 ${zipName}`;
                // Let user pick from multiple TXT files inside the ZIP
                this.app.explorer.show(
                    [{ id: 'zip_root', name: zipName }], 
                    txtFiles, 
                    (item) => {
                        this.extractAndLoad(zipName, item.name, item.zipEntry);
                    },
                    null // Disable further folder traversal inside zip for simplicity
                );
            }
        } catch (e) {
            console.error(e);
            this.app.showToast('ZIP 檔案解析失敗！可能檔案已損毀。');
        }
    }

    async extractAndLoad(zipName, fileName, zipEntry) {
        this.app.showToast(`正在解壓縮 ${fileName}...`);
        try {
            const uint8array = await zipEntry.async("uint8array");
            const text = this.app.decodeText(uint8array);
            
            const finalName = `[${zipName}] ${fileName}`;
            await this.app.db.saveBook(finalName, text);
            this.app.loadBookIntoReader(finalName, text);
        } catch (e) {
            console.error(e);
            this.app.showToast('解壓縮或載入失敗！');
        }
    }

}

window.ZenZipHandler = ZipHandler;
