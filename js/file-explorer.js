class FileExplorer {
    constructor(app) {
        this.app = app;
        this.onSelect = null;
        this.path = []; // Initial path is empty (root)
        this.onNavigate = null; // Callback when navigating to a folder
        
        this.listEl = document.getElementById('file-explorer-list');
        this.breadcrumbsEl = document.getElementById('file-explorer-breadcrumbs');
        this.footerEl = document.getElementById('welcome-footer');
        this.overflowContainer = document.getElementById('breadcrumb-overflow-container');
        this.overflowBtn = document.getElementById('breadcrumb-overflow-btn');
        this.dropdownEl = document.getElementById('breadcrumb-dropdown');
        this.scrollCache = {};
        
        if (this.overflowBtn) {
            this.overflowBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.dropdownEl.classList.toggle('hidden');
            });
            document.addEventListener('click', (e) => {
                if (!this.overflowContainer.contains(e.target)) {
                    this.dropdownEl.classList.add('hidden');
                }
            });
        }
        
        if (this.breadcrumbsEl) {
            this.resizeObserver = new ResizeObserver(() => this.checkBreadcrumbOverflow());
            this.resizeObserver.observe(this.breadcrumbsEl);
        }
    }

    saveScrollState() {
        const currentFolderId = this.path.length > 0 ? this.path[this.path.length - 1].id : 'root';
        const scrollTop = this.listEl.parentElement ? this.listEl.parentElement.scrollTop : this.listEl.scrollTop;
        this.scrollCache[currentFolderId] = scrollTop;
    }

    show(path, items, onSelect, onNavigate) {
        this.path = path;
        this.onSelect = onSelect;
        this.onNavigate = onNavigate;
        
        this.renderBreadcrumbs();
        this.renderList(items);
    }

    renderBreadcrumbs() {
        if (!this.footerEl || !this.breadcrumbsEl) return;
        
        if (this.path.length === 0) {
            this.footerEl.classList.add('hidden');
            return;
        } else {
            this.footerEl.classList.remove('hidden');
        }

        this.breadcrumbsEl.innerHTML = '';
        this.dropdownEl.innerHTML = '';
        
        // Root node
        const rootItem = document.createElement('span');
        rootItem.className = 'breadcrumb-item';
        const rootText = this.app.i18n ? this.app.i18n.t('sourceGDrive') || 'GDrive' : 'GDrive';
        rootItem.textContent = rootText;
        rootItem.onclick = () => {
            this.saveScrollState();
            if (this.onNavigate) this.onNavigate('root');
        };
        this.breadcrumbsEl.appendChild(rootItem);
        this.addDropdownItem(rootText, 'root');

        // Path nodes
        this.path.forEach((folder, index) => {
            const separator = document.createElement('span');
            separator.className = 'breadcrumb-separator';
            separator.textContent = ' / ';
            this.breadcrumbsEl.appendChild(separator);

            const pathItem = document.createElement('span');
            pathItem.className = 'breadcrumb-item';
            pathItem.textContent = folder.name;
            
            pathItem.onclick = () => {
                this.saveScrollState();
                if (this.onNavigate) this.onNavigate(folder.id, index + 1);
            };
            this.breadcrumbsEl.appendChild(pathItem);
            this.addDropdownItem(folder.name, folder.id, index + 1);
        });

        // Trigger overflow check manually once rendered
        this.checkBreadcrumbOverflow();
    }
    
    addDropdownItem(name, id, depth = -1) {
        if (!this.dropdownEl) return;
        const item = document.createElement('div');
        item.className = 'breadcrumb-dropdown-item';
        
        // Add indentation for subfolders in dropdown
        let indent = '';
        if (depth >= 0) {
            indent = '└─ '.padStart(depth * 3 + 3, '　');
        }
        item.textContent = indent + name;
        item.title = name;
        item.onclick = () => {
            this.dropdownEl.classList.add('hidden');
            this.saveScrollState();
            if (this.onNavigate) {
                if (id === 'root') this.onNavigate('root');
                else this.onNavigate(id, depth);
            }
        };
        this.dropdownEl.appendChild(item);
    }
    
    checkBreadcrumbOverflow() {
        if (!this.breadcrumbsEl || !this.overflowContainer) return;
        if (this.breadcrumbsEl.scrollWidth > this.breadcrumbsEl.clientWidth + 5) {
            this.overflowContainer.classList.remove('hidden');
        } else {
            this.overflowContainer.classList.add('hidden');
            this.dropdownEl.classList.add('hidden');
        }
    }

    renderList(items) {
        this.listEl.innerHTML = '';
        
        if (!items || items.length === 0) {
            const emptyState = document.createElement('li');
            emptyState.className = 'file-item';
            emptyState.style.justifyContent = 'center';
            emptyState.style.color = 'var(--color-text-muted)';
            emptyState.textContent = this.app.i18n ? this.app.i18n.t('actionNone') || '無資料' : '沒有找到任何檔案或資料夾';
            this.listEl.appendChild(emptyState);
            return;
        }

        // Sort items: folders first, then files alphabetically
        items.sort((a, b) => {
            if (a.type === 'folder' && b.type !== 'folder') return -1;
            if (a.type !== 'folder' && b.type === 'folder') return 1;
            return a.name.localeCompare(b.name);
        });

        items.forEach(item => {
            const li = document.createElement('li');
            li.className = 'file-item';
            
            const iconSpan = document.createElement('span');
            iconSpan.className = 'file-icon';
            if (item.type === 'folder') {
                iconSpan.innerHTML = '📁';
            } else if (item.mimeType === 'application/zip' || item.name.endsWith('.zip')) {
                iconSpan.innerHTML = '📦';
            } else {
                iconSpan.innerHTML = '📄';
            }

            const nameSpan = document.createElement('span');
            nameSpan.className = 'file-name';
            nameSpan.textContent = item.name;

            li.appendChild(iconSpan);
            li.appendChild(nameSpan);

            li.addEventListener('click', () => {
                if (item.type === 'folder') {
                    this.saveScrollState();
                    if (this.onNavigate) {
                        this.onNavigate(item.id, -1, item.name); // passing folder data to append
                    }
                } else {
                    if (this.onSelect) {
                        this.onSelect(item);
                    }
                }
            });

            this.listEl.appendChild(li);
        });

        // Restore scroll position or scroll to top
        const currentFolderId = this.path.length > 0 ? this.path[this.path.length - 1].id : 'root';
        const targetScroll = this.scrollCache[currentFolderId] || 0;
        
        this.listEl.scrollTop = targetScroll;
        if (this.listEl.parentElement) {
            this.listEl.parentElement.scrollTop = targetScroll;
        }
    }

    showEmptyDropHint() {
        this.listEl.innerHTML = `
            <li class="empty-drop-hint file-explorer-empty">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.5; margin-bottom:1rem;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                <div data-i18n="dropzoneHint">${this.app.i18n ? this.app.i18n.t('dropzoneHint') : '將檔案拖曳至此，或自左上角雲端載入'}</div>
            </li>
        `;
        if (this.footerEl) {
            this.footerEl.classList.add('hidden');
        }
    }
}

window.FileExplorer = FileExplorer;
