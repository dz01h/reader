class ExplorerPanel extends Component {
    constructor() {
        super();
        this.initComponent();
    }

    connectedCallback() {
        this.bindParentDialog();
        this.bindBodyDragAndDrop();
        this.loadData();
    }

    initComponent() {
        // File Panel embedding
        this.filePanel = this.querySelector('file-panel');
        if (!this.filePanel) {
            this.filePanel = document.createElement('file-panel');
            this.appendChild(this.filePanel);
        }
    }

    bindBodyDragAndDrop() {
        if (typeof document === 'undefined' || !document.body || document.body._explorerDndBound) return;
        document.body._explorerDndBound = true;

        let dragCounter = 0;

        document.body.addEventListener('dragenter', (e) => {
            e.preventDefault();
            dragCounter++;
            document.body.classList.add('drag-over');
        });

        document.body.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (e.dataTransfer) {
                e.dataTransfer.dropEffect = 'copy';
            }
        });

        document.body.addEventListener('dragleave', (e) => {
            e.preventDefault();
            dragCounter = Math.max(0, dragCounter - 1);
            if (dragCounter === 0) {
                document.body.classList.remove('drag-over');
            }
        });

        document.body.addEventListener('drop', async (e) => {
            e.preventDefault();
            dragCounter = 0;
            document.body.classList.remove('drag-over');

            const files = Array.from(e.dataTransfer?.files || []);
            if (files.length === 0) return;

            try {
                // Open first file immediately
                await this.openFile(files[0]);

                // Batch save remaining .txt files into OPFS if multiple files dropped
                if (files.length > 1 && window.ZenOPFS && typeof window.ZenOPFS.saveFile === 'function') {
                    for (let i = 1; i < files.length; i++) {
                        const file = files[i];
                        if (file.name.toLowerCase().endsWith('.txt')) {
                            const text = await file.text();
                            await window.ZenOPFS.saveFile(file.name, text);
                        }
                    }
                    if (this.filePanel && typeof this.filePanel.refresh === 'function') {
                        this.filePanel.refresh();
                    }
                }
            } catch (err) {
                console.error('[ExplorerPanel] 拖放檔案載入失敗:', err);
                if (window._app && typeof window._app.logError === 'function') {
                    window._app.logError(err);
                }
            }
        });
    }

    bindParentDialog() {
        const dialog = this.parentElement || this.closest?.('dialog');
        if (!dialog || dialog._explorerPanelBound) return;
        dialog._explorerPanelBound = true;

        dialog.addEventListener('initComponent', e => { (e.newState === 'open') && this.loadData(); });
        dialog.addEventListener('open', () => this.loadData());

        // Observe open attribute on dialog
        const observer = new MutationObserver(mutations => {
            for (const m of mutations) {
                if (m.type === 'attributes' && m.attributeName === 'open' && dialog.open) {
                    this.loadData();
                }
            }
        });
        observer.observe(dialog, { attributes: true, attributeFilter: ['open'] });

        // Click outside (backdrop) to close dialog
        dialog.addEventListener('click', e => {
            if (e.target === dialog) {
                const rect = dialog.getBoundingClientRect();
                const isOutside = (
                    e.clientX < rect.left ||
                    e.clientX > rect.right ||
                    e.clientY < rect.top ||
                    e.clientY > rect.bottom
                );
                if (isOutside && typeof dialog.close === 'function') {
                    dialog.close();
                }
            }
        });
    }

    loadData() {
        if (this.filePanel && typeof this.filePanel.refresh === 'function') {
            if(!this.filePanel.source)
                this.filePanel.setSource(FileSource.getInstance());
            else
                this.filePanel.refresh();
        }
    }

    /**
     * Open a file from any source, FileItem, File, Blob, or ReadableStream.
     * If the file is a ZIP archive, automatically unpacks text files using JSZip/ZipHandler.
     * Dispatches 'ReadingOperation' event to notify ReadingPanel to start reading.
     * @param {Object|File|Blob|ReadableStream|ArrayBuffer|string} target 
     * @param {FileSource} [source] 
     * @returns {Promise<ReadingDocument|null>}
     */
    async openFile(target, source = this.filePanel?.source) {
        if (!target) return null;

        let filename = '';
        let fileId = '';
        let rawData = null; // string | Blob | ArrayBuffer | Uint8Array | ReadableStream

        // 1. Identify and resolve raw data from target
        if ((typeof Blob !== 'undefined' && target instanceof Blob) || (typeof File !== 'undefined' && target instanceof File)) {
            filename = target.name || 'document.txt';
            fileId = filename;
            rawData = target;
        } else if (typeof target === 'string') {
            if (target.includes('\n') || target.length > 500) {
                // Treated as raw text content
                filename = 'document.txt';
                fileId = 'document.txt';
                rawData = target;
            } else if (source && typeof source.loadFile === 'function') {
                filename = target;
                fileId = target;
                rawData = await source.loadFile(target);
            } else {
                filename = target;
                fileId = target;
                rawData = target;
            }
        } else if (typeof target === 'object' && target !== null) {
            if (typeof ReadableStream !== 'undefined' && target instanceof ReadableStream) {
                filename = 'document.txt';
                fileId = filename;
                rawData = target;
            } else {
                filename = target.name || target.id || 'document.txt';
                fileId = target.id || target.name || filename;

                if (target.data !== undefined) {
                    rawData = target.data;
                } else if (target.stream !== undefined) {
                    rawData = target.stream;
                } else if (target.content !== undefined) {
                    rawData = target.content;
                } else if (source && typeof source.loadFile === 'function') {
                    rawData = await source.loadFile(target);
                }
            }
        }

        if (!rawData) {
            throw new Error(`無法從來源載入檔案內容: ${filename}`);
        }

        // 2. Handle ZIP archive unpacking
        if (filename.toLowerCase().endsWith('.zip')) {
            return await this.handleZipFile(rawData, filename, target, source);
        }

        // 3. Resolve binary data / stream to text
        const text = await this.resolveToText(rawData);
        if (typeof text !== 'string') {
            throw new Error(`無法將檔案轉換為文字內容: ${filename}`);
        }

        // 4. Determine origin source tag
        const isFileObject = (typeof Blob !== 'undefined' && target instanceof Blob) || 
                             (typeof File !== 'undefined' && target instanceof File);
        let sourceTag = source?.id || '';
        if (isFileObject) {
            sourceTag = 'local';
        }

        // 5. Create ReadingDocument and restore reading progress
        const doc = new window.ReadingDocument(text, filename, sourceTag);

        let progress = 0;
        if (typeof target.progress === 'number') {
            progress = target.progress;
        } else if (window._app && window._app.positions && window._app.positions[fileId]) {
            progress = window._app.positions[fileId].progress || 0;
        }

        if (progress > 0) {
            doc.setProgress(progress);
        }

        if (window._app) {
            window._app.lastBookId = fileId;
            if (typeof window._app.saveState === 'function') {
                window._app.saveState();
            }
        }

        // 6. Notify ReadingPanel (and OPFSFileSource) via ReadingOperation event
        this.fireEvent('ReadingOperation', {
            action: 'read',
            params: [doc]
        }, true);

        // Also fire fileSelected on explorer-panel
        this.fireEvent('fileSelected', {
            item: target,
            source: source,
            doc: doc,
            filename: filename
        }, true);

        // 7. Close parent dialog
        const dialog = this.parentElement || this.closest?.('dialog');
        if (dialog && typeof dialog.close === 'function') {
            dialog.close();
        }

        return doc;
    }

    async handleZipFile(rawData, zipName, target, source) {
        let blobOrBuffer = rawData;
        if (typeof ReadableStream !== 'undefined' && rawData instanceof ReadableStream) {
            blobOrBuffer = await this.streamToUint8Array(rawData);
        }

        if (window.ZenZipHandler && window._app) {
            const zipHandler = new window.ZenZipHandler(window._app);
            await zipHandler.processZip(blobOrBuffer, zipName);
            const dialog = this.parentElement || this.closest?.('dialog');
            if (dialog && typeof dialog.close === 'function') {
                dialog.close();
            }
            return null;
        }

        if (!window.JSZip) {
            throw new Error('未載入 JSZip 函式庫，無法解壓縮 ZIP 檔案');
        }

        const zip = new window.JSZip();
        const contents = await zip.loadAsync(blobOrBuffer);
        const txtFiles = [];

        contents.forEach((relativePath, zipEntry) => {
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
            throw new Error('ZIP 壓縮檔內找不到任何 .txt 文字檔！');
        }

        if (txtFiles.length === 1) {
            const uint8array = await txtFiles[0].zipEntry.async('uint8array');
            const text = this.decodeText(uint8array);
            const bookName = `[${zipName}] ${txtFiles[0].name}`;

            const doc = new window.ReadingDocument(text, bookName, 'zip');
            if (window._app) {
                window._app.lastBookId = bookName;
                if (typeof window._app.saveState === 'function') {
                    window._app.saveState();
                }
            }

            this.fireEvent('ReadingOperation', {
                action: 'read',
                params: [doc]
            }, true);

            const dialog = this.parentElement || this.closest?.('dialog');
            if (dialog && typeof dialog.close === 'function') {
                dialog.close();
            }

            return doc;
        } else {
            if (window.ZenZipHandler && window._app) {
                const zipHandler = new window.ZenZipHandler(window._app);
                await zipHandler.processZip(blobOrBuffer, zipName);
            }
            return null;
        }
    }

    async resolveToText(data) {
        if (typeof data === 'string') return data;
        if (typeof ReadableStream !== 'undefined' && data instanceof ReadableStream) {
            const uint8array = await this.streamToUint8Array(data);
            return this.decodeText(uint8array);
        }
        if ((typeof Blob !== 'undefined' && data instanceof Blob) || (typeof File !== 'undefined' && data instanceof File)) {
            if (typeof data.text === 'function') {
                return await data.text();
            }
            const arrayBuffer = await data.arrayBuffer();
            return this.decodeText(new Uint8Array(arrayBuffer));
        }
        if (data instanceof ArrayBuffer) {
            return this.decodeText(new Uint8Array(data));
        }
        if (data instanceof Uint8Array) {
            return this.decodeText(data);
        }
        return String(data);
    }

    async streamToUint8Array(stream) {
        const reader = stream.getReader();
        const chunks = [];
        let totalLength = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            totalLength += value.length;
        }
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
        }
        return result;
    }

    decodeText(uint8array) {
        if (window._app && typeof window._app.decodeText === 'function') {
            return window._app.decodeText(uint8array);
        }
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
    window.ExplorerPanel = ExplorerPanel;
    customElements.define('explorer-panel', ExplorerPanel);
}
