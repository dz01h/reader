/**
 * FileSource Base Class
 * Abstract interface / parent object for file listing and document loading data sources.
 */
class FileSource extends ToggleButton {
    constructor(id = 'source', name = 'Source') {
        super();
        this.id = id;
        this.name = name;
        this.path = []; // Breadcrumb path: [{ id: string, name: string }]
        this.canDelete = false;
    }

    initComponent() {
        super.initComponent();
        this.classList.add('file-source');
        this.action = 'FilePanel:toggleSource';
        this.switching.setAttribute('name', 'filepanel-sources');
    }

    static getInstance() {
        if (typeof document === 'undefined') return null;

        // 1. Check if any file-source radio is currently checked in memory or attributes
        const sources = document.querySelectorAll('.file-source, opfs-file-source, gdrive-file-source');
        for (const src of sources) {
            if (src.switching && src.switching.checked) {
                return src;
            }
            if (src.hasAttribute && src.hasAttribute('checked')) {
                return src;
            }
        }

        // 2. Query selector fallback for input:checked
        const checkedInput = document.querySelector('.file-source input[type="radio"]:checked');
        if (checkedInput) {
            const src = checkedInput.closest('.file-source') || checkedInput.parentElement;
            if (src) return src;
        }

        // 3. Fallback to default OPFS element in DOM
        return document.getElementById('btn-recent-books') ||
               document.querySelector('opfs-file-source') ||
               document.querySelector('.file-source') ||
               null;
    }

    /**
     * List files and folders in the current path
     * @returns {Promise<Array<{ id: string, name: string, type: 'file' | 'folder', size?: number, lastModified?: number, progress?: number, progressTimestamp?: number, data?: any }>>}
     */
    async listFiles() {
        return [];
    }

    /**
     * Load the content of a specific file
     * @param {Object|string} fileItem File item object or identifier
     * @returns {Promise<string>} Text content of the file
     */
    async loadFile(fileItem) {
        throw new Error('loadFile() must be implemented by subclass of FileSource');
    }

    /**
     * Delete a specific file from the source
     * @param {Object|string} fileItem File item object or identifier
     * @returns {Promise<boolean>} True if deleted successfully
     */
    async deleteFile(fileItem) {
        return false;
    }

    /**
     * Save a file to the source
     * @param {string} filename
     * @param {string|Blob|ArrayBuffer} content
     * @returns {Promise<boolean>}
     */
    async saveFile(filename, content) {
        return false;
    }

    /**
     * Navigate into a folder or jump to a specific path depth
     * @param {string} folderId Target folder ID or 'root'
     * @param {number} [depth] Breadcrumb depth index (-1 for automatic)
     */
    async navigate(folderId, depth = -1, name = '') {
        if (folderId === 'root') {
            this.path = [];
        } else if (depth >= 0 && depth < this.path.length) {
            this.path = this.path.slice(0, depth + 1);
        } else {
            this.path.push({ id: folderId, name: name || folderId });
        }
    }

    /**
     * Get parent folder ID or null if at root
     * @returns {string|null}
     */
    getParentId() {
        if (this.path.length <= 1) return 'root';
        return this.path[this.path.length - 2].id;
    }
}

if (typeof window !== 'undefined') {
    window.FileSource = FileSource;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { FileSource };
}
