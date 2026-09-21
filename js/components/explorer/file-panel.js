class FilePanel extends Component {
    static DEFAULT_STYLE = `
        :host {
            display: block;
            width: 100%;
            height: 100%;
            box-sizing: border-box;
            user-select: none;
        }

        .file-list-container {
            display: flex;
            flex-direction: column;
            gap: 0.6rem;
            width: 100%;
            padding: 0.25rem 0;
            box-sizing: border-box;
        }

        .file-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0.75rem 1rem;
            background-color: var(--color-surface, #ffffff);
            border: 1px solid var(--color-border, #e2e8f0);
            border-radius: var(--radius-md, 8px);
            cursor: pointer;
            transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease;
            box-sizing: border-box;
            gap: 0.75rem;
        }

        .file-item:hover {
            border-color: var(--color-primary, #667eea);
            box-shadow: var(--shadow-sm, 0 2px 4px rgba(0,0,0,0.05));
            transform: translateY(-1px);
        }

        .file-item:active {
            transform: translateY(0);
        }

        .file-item-left {
            display: flex;
            align-items: center;
            gap: 0.85rem;
            flex: 1;
            min-width: 0;
        }

        .file-icon {
            flex-shrink: 0;
            width: 36px;
            height: 36px;
            display: flex;
            align-items: center;
            justify-content: center;
            background-color: rgba(102, 126, 234, 0.1);
            color: var(--color-primary, #667eea);
            border-radius: 8px;
        }

        .file-details {
            display: flex;
            flex-direction: column;
            gap: 0.25rem;
            flex: 1;
            min-width: 0;
        }

        .file-title {
            font-size: 0.95rem;
            font-weight: 600;
            color: var(--color-text, #2d3748);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .file-meta {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            font-size: 0.8rem;
            color: var(--color-text-muted, #718096);
            flex-wrap: wrap;
        }

        .file-progress-bar {
            width: 80px;
            height: 5px;
            background-color: var(--color-border, #e2e8f0);
            border-radius: 3px;
            overflow: hidden;
            display: inline-block;
        }

        .file-progress-fill {
            height: 100%;
            background-color: var(--color-primary, #667eea);
            border-radius: 3px;
        }

        .file-item-right {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            flex-shrink: 0;
        }

        .btn-delete-file {
            background: transparent;
            border: none;
            color: var(--color-text-muted, #718096);
            cursor: pointer;
            padding: 0.4rem;
            border-radius: 6px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: color 0.15s ease, background-color 0.15s ease;
        }

        .btn-delete-file:hover {
            color: #ef4444;
            background-color: rgba(239, 68, 68, 0.1);
        }

        .breadcrumbs-bar {
            display: flex;
            align-items: center;
            gap: 0.4rem;
            padding: 0.4rem 0.75rem;
            background-color: rgba(102, 126, 234, 0.06);
            border: 1px solid var(--color-border, #e2e8f0);
            border-radius: var(--radius-md, 8px);
            font-size: 0.85rem;
            color: var(--color-text-muted, #718096);
            overflow-x: auto;
            white-space: nowrap;
            box-sizing: border-box;
        }

        .breadcrumb-item {
            cursor: pointer;
            color: var(--color-primary, #667eea);
            display: inline-flex;
            align-items: center;
            gap: 0.25rem;
            transition: color 0.15s ease;
        }

        .breadcrumb-item:hover {
            text-decoration: underline;
        }

        .breadcrumb-item.current {
            color: var(--color-text, #2d3748);
            cursor: default;
            font-weight: 600;
        }

        .breadcrumb-item.current:hover {
            text-decoration: none;
        }

        .breadcrumb-separator {
            color: var(--color-text-muted, #a0aec0);
            user-select: none;
        }

        .empty-state, .loading-state {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 3rem 1.5rem;
            color: var(--color-text-muted, #718096);
            text-align: center;
            gap: 0.75rem;
        }

        .empty-icon {
            color: var(--color-text-muted, #a0aec0);
            opacity: 0.6;
        }
    `;

    constructor() {
        super();
        this.source = null;
        this.items = [];
        this.isLoading = false;
        this.sortField = 'name';
        this.sortOrder = 'ASC';
        this.initComponent();
    }

    connectedCallback() {
        if (!this._fileSourceChangedBound && typeof document !== 'undefined' && document.body) {
            this._fileSourceChangedBound = true;
            document.body.addEventListener('fileSourceChanged', (e) => {
                if (this.source && this.source.id === e.detail?.source) {
                    this.refresh();
                }
            });
        }

        if (!this.source) {
            this.setSource(new window.OPFSFileSource());
        } else {
            this.refresh();
        }
    }

    initComponent() {
        const host = this.attachShadow({ mode: 'open' });
        const style = new CSSStyleSheet();
        style.replaceSync(FilePanel.DEFAULT_STYLE);
        host.adoptedStyleSheets = [style];

        this.container = document.createElement('div');
        this.container.className = 'file-list-container';
        host.appendChild(this.container);
    }

    setSource(source) {
        this.source = source;
        this.refresh();
    }

    setSort(field = 'name', order = 'ASC') {
        this.sortField = field;
        this.sortOrder = (order || 'ASC').toUpperCase();
        this.sortItems();
        this.renderList();
    }

    sortItems() {
        if (!this.items || this.items.length === 0) return;
        const field = this.sortField || 'name';
        const isAsc = (this.sortOrder || 'ASC') === 'ASC';

        this.items.sort((a, b) => {
            // Folders always at top
            if (a.type === 'folder' && b.type !== 'folder') return -1;
            if (a.type !== 'folder' && b.type === 'folder') return 1;

            let result = 0;
            if (field === 'name') {
                result = (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' });
            } else if (field === 'date') {
                const timeA = a.progressTimestamp || a.lastModified || 0;
                const timeB = b.progressTimestamp || b.lastModified || 0;
                result = timeA - timeB;
            } else if (field === 'size') {
                const sizeA = a.size || 0;
                const sizeB = b.size || 0;
                result = sizeA - sizeB;
            }
            return isAsc ? result : -result;
        });
    }

    async refresh() {
        if (!this.source || !this.container) return;

        this.isLoading = true;
        this.renderLoading();

        try {
            this.items = await this.source.listFiles();
            this.sortItems();
        } catch (err) {
            console.error('FilePanel list error:', err);
            this.items = [];
        } finally {
            this.isLoading = false;
        }

        this.renderList();
    }

    renderLoading() {
        this.container.innerHTML = `
            <div class="loading-state">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite;">
                    <line x1="12" y1="2" x2="12" y2="6"></line>
                    <line x1="12" y1="18" x2="12" y2="22"></line>
                    <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
                    <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
                    <line x1="2" y1="12" x2="6" y2="12"></line>
                    <line x1="18" y1="12" x2="22" y2="12"></line>
                    <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
                    <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
                </svg>
                <span>載入中...</span>
            </div>
        `;
    }

    renderList() {
        this.container.innerHTML = '';

        // 1. Render Breadcrumbs Bar if navigated inside subfolders
        if (this.source && this.source.path && this.source.path.length > 0) {
            const breadcrumbsEl = document.createElement('div');
            breadcrumbsEl.className = 'breadcrumbs-bar';

            const rootItem = document.createElement('span');
            rootItem.className = 'breadcrumb-item';
            rootItem.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg> 根目錄`;
            rootItem.addEventListener('click', async () => {
                await this.source.navigate('root');
                await this.refresh();
            });
            breadcrumbsEl.appendChild(rootItem);

            this.source.path.forEach((seg, idx) => {
                const sep = document.createElement('span');
                sep.className = 'breadcrumb-separator';
                sep.textContent = '/';
                breadcrumbsEl.appendChild(sep);

                const isLast = idx === this.source.path.length - 1;
                const segEl = document.createElement('span');
                segEl.className = isLast ? 'breadcrumb-item current' : 'breadcrumb-item';
                segEl.textContent = seg.name || seg.id;

                if (!isLast) {
                    segEl.addEventListener('click', async () => {
                        await this.source.navigate(seg.id, idx, seg.name);
                        await this.refresh();
                    });
                }

                breadcrumbsEl.appendChild(segEl);
            });

            this.container.appendChild(breadcrumbsEl);
        }

        if (!this.items || this.items.length === 0) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'empty-state';
            emptyEl.innerHTML = `
                <svg class="empty-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
                </svg>
                <span data-i18n="emptyLibrary">此資料夾沒有書籍檔案</span>
                <small style="opacity: 0.7;">可由本機或雲端加入檔案</small>
            `;
            this.container.appendChild(emptyEl);
            return;
        }

        for (const item of this.items) {
            const itemEl = document.createElement('div');
            itemEl.className = 'file-item';

            const isFolder = item.type === 'folder';
            const iconSvg = isFolder
                ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`
                : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`;

            const sizeText = item.size ? this.formatFileSize(item.size) : '';
            const dateText = item.lastModified ? this.formatDate(item.lastModified) : '';
            const progressPct = item.progress ? (item.progress * 100).toFixed(1) : '0.0';

            const progressHtml = (!isFolder && item.progress > 0)
                ? `
                    <div style="display: flex; align-items: center; gap: 0.4rem;">
                        <div class="file-progress-bar">
                            <div class="file-progress-fill" style="width: ${progressPct}%;"></div>
                        </div>
                        <span>${progressPct}%</span>
                    </div>
                `
                : '';

            itemEl.innerHTML = `
                <div class="file-item-left">
                    <div class="file-icon">${iconSvg}</div>
                    <div class="file-details">
                        <div class="file-title" title="${item.name}">${item.name}</div>
                        <div class="file-meta">
                            ${progressHtml}
                            ${sizeText ? `<span>${sizeText}</span>` : ''}
                            ${dateText ? `<span>${dateText}</span>` : ''}
                        </div>
                    </div>
                </div>
                <div class="file-item-right">
                    <button class="btn-delete-file" title="刪除檔案">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                </div>
            `;

            // Delete button handler
            const deleteBtn = itemEl.querySelector('.btn-delete-file');
            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (confirm(`確定要刪除「${item.name}」嗎？`)) {
                    await this.source.deleteFile(item);
                    await this.refresh();
                }
            });

            // Item select handler
            itemEl.addEventListener('click', async () => {
                await this.handleItemClick(item);
            });

            this.container.appendChild(itemEl);
        }
    }

    async handleItemClick(item) {
        if (item.type === 'folder') {
            await this.source.navigate(item.id, -1, item.name);
            await this.refresh();
            return;
        }

        const explorer = this.closest('explorer-panel') || (this.getRootNode && this.getRootNode().host?.closest?.('explorer-panel'));
        if (explorer && typeof explorer.openFile === 'function') {
            try {
                await explorer.openFile(item, this.source);
            } catch (err) {
                console.error('Failed to open file via ExplorerPanel:', err);
                alert(`無法開啟檔案：${err.message}`);
            }
            return;
        }

        // Fallback standalone opening
        try {
            const content = await this.source.loadFile(item);
            if (content && window.ReadingDocument) {
                const doc = new window.ReadingDocument(content, item.name || item.id, this.source?.id || 'opfs');
                if (typeof item.progress === 'number' && item.progress > 0) {
                    doc.setProgress(item.progress);
                }

                if (window._app) {
                    window._app.lastBookId = item.name || item.id;
                    if (typeof window._app.saveState === 'function') {
                        window._app.saveState();
                    }
                }

                this.fireEvent('ReadingOperation', {
                    action: 'read',
                    params: [doc]
                }, true);

                this.fireEvent('fileSelected', { item, source: this.source, doc }, true);

                // Close parent dialog if present
                const dialog = this.parentElement || this.closest?.('dialog');
                if (dialog && typeof dialog.close === 'function') {
                    dialog.close();
                }
            }
        } catch (err) {
            console.error('Failed to open file:', err);
            alert(`無法開啟檔案：${err.message}`);
        }
    }

    formatFileSize(bytes) {
        if (!bytes || bytes <= 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
    }

    formatDate(timestamp) {
        if (!timestamp) return '';
        const d = new Date(timestamp);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}/${m}/${day}`;
    }
}

if (typeof window !== 'undefined') {
    window.FilePanel = FilePanel;
    customElements.define('file-panel', FilePanel);
}
