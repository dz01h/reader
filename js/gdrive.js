class GDriveModule {
    constructor(app) {
        this.app = app;
        this.SCOPES = 'https://www.googleapis.com/auth/drive.readonly';
        
        this.tokenClient = null;
        this.accessToken = null;
        this.currentPath = []; // Array of {id, name}
        
        this.initAuth();
    }

    initAuth() {
        // 動態載入 Google Identity Services 腳本
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
    }

    handleAuthClick() {
        if (!window.google || !window.google.accounts) {
            this.app.showToast(this.app.i18n ? this.app.i18n.t('gdriveLoading') : 'Google API 仍在載入中...');
            return;
        }

        const clientId = this.app.currentGoogleClientId;
        if (!clientId || clientId.trim() === '') {
            this.app.showToast(this.app.i18n ? this.app.i18n.t('gdriveMissingId') : 'Missing Client ID');
            const settingsBtn = document.getElementById('btn-open-settings');
            if (settingsBtn) settingsBtn.click();
            return;
        }

        // 每次點擊都以最新的 Client ID 初始化
        this.tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: clientId.trim(),
            scope: this.SCOPES,
            callback: (tokenResponse) => {
                if (tokenResponse.error !== undefined) {
                    this.app.showToast(this.app.i18n ? this.app.i18n.t('gdriveLoginFail') : 'Login Failed');
                    throw (tokenResponse);
                }
                this.accessToken = tokenResponse.access_token;
                this.currentPath = [];
                this.fetchFolder('root');
            },
        });

        if (this.accessToken === null) {
            // Trigger OAuth popup
            this.tokenClient.requestAccessToken({prompt: 'consent'});
        } else {
            // Already logged in
            this.currentPath = [];
            this.fetchFolder('root');
        }
    }

    async fetchFolder(folderId) {
        this.app.showToast(this.app.i18n ? this.app.i18n.t('gdriveFetching') : 'Fetching...');
        try {
            // Query for folders, txt, and zip
            const mimeFilter = "(mimeType='application/vnd.google-apps.folder' or mimeType='text/plain' or mimeType='application/zip')";
            let query = '';
            
            if (folderId === 'virtual_shared') {
                query = encodeURIComponent(`sharedWithMe = true and trashed = false and ${mimeFilter}`);
            } else {
                query = encodeURIComponent(`trashed = false and '${folderId}' in parents and ${mimeFilter}`);
            }

            const response = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,mimeType)&pageSize=1000&includeItemsFromAllDrives=true&supportsAllDrives=true`, {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`
                }
            });
            const data = await response.json();
            
            let items = (data.files || []).map(f => ({
                id: f.id,
                name: f.name,
                mimeType: f.mimeType,
                type: f.mimeType === 'application/vnd.google-apps.folder' ? 'folder' : 'file'
            }));

            // Inject Virtual 'Shared with me' folder if we are at root
            if (folderId === 'root') {
                items.unshift({
                    id: 'virtual_shared',
                    name: '🤝 與我共用 (Shared with me)',
                    mimeType: 'application/vnd.google-apps.folder',
                    type: 'folder'
                });
            }

            this.app.explorer.show(
                this.currentPath, 
                items, 
                // onSelect (file)
                (item) => {
                    this.downloadFile(item.id, item.name, item.mimeType);
                },
                // onNavigate (folder)
                (targetFolderId, pathCutIndex, folderName) => {
                    if (targetFolderId === 'root') {
                        this.currentPath = [];
                        this.fetchFolder('root');
                    } else if (pathCutIndex !== -1 && pathCutIndex !== undefined) {
                        // User clicked a breadcrumb
                        this.currentPath = this.currentPath.slice(0, pathCutIndex);
                        this.fetchFolder(targetFolderId);
                    } else {
                        // User clicked a subfolder
                        this.currentPath.push({ id: targetFolderId, name: folderName });
                        this.fetchFolder(targetFolderId);
                    }
                }
            );

        } catch (err) {
            console.error('GDrive Fetch Error:', err);
            this.app.showToast(this.app.i18n ? this.app.i18n.t('gdriveFetchFail') : 'Fetch failed');
        }
    }

    async downloadFile(fileId, fileName, mimeType) {
        this.app.showToast(this.app.i18n ? this.app.i18n.t('gdriveDownloading', fileName) : `Downloading ${fileName}...`);
        try {
            const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`
                }
            });

            if (mimeType === 'application/zip' || fileName.endsWith('.zip')) {
                const blob = await response.blob();
                if (this.app.zipHandler) {
                    this.app.zipHandler.processZip(blob, fileName);
                } else {
                    this.app.showToast(this.app.i18n ? this.app.i18n.t('gdriveZipDev') : 'ZIP support coming soon.');
                }
            } else {
                const text = await response.text();
                await this.app.db.saveBook(fileName, text);
                this.app.loadBookIntoReader(fileName, text);
            }
        } catch (err) {
            console.error('Download Error:', err);
            this.app.showToast(this.app.i18n ? this.app.i18n.t('gdriveDownloadFail') : 'Download failed');
        }
    }
}

window.ZenGDrive = GDriveModule;
