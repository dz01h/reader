class GDriveModule {
    constructor(app) {
        this.app = app;
        this.accessToken = null;
        this.expiresAt = 0;
        this.currentPath = []; // Array of {id, name}

        // Load cached token
        const cached = localStorage.getItem('gdrive_auth');
        if (cached) {
            try {
                const auth = JSON.parse(cached);
                if (auth.expiresAt > Date.now()) {
                    this.accessToken = auth.accessToken;
                    this.expiresAt = auth.expiresAt;
                }
            } catch(e) {}
        }

        window.addEventListener('message', this.handleAuthMessage.bind(this));
    }

    handleAuthMessage(event) {
        if (event.origin !== 'https://google.com' && !event.origin.endsWith('googleusercontent.com')) return;

        if (event.data.type === 'accessToken' && event.data.access_token && this.wait2Auth) {
            const resolve = this.wait2Auth;
            this.wait2Auth = null;

            // Save token and calculated expiry
            const expiresAt = Date.now() + (event.data.expires_in || 3600) * 1000;
            localStorage.setItem('gdrive_auth', JSON.stringify({
                accessToken: event.data.access_token,
                expiresAt: expiresAt
            }));
            this.accessToken = event.data.access_token;
            this.expiresAt = expiresAt;

            resolve(event.data);
        }
    }

    async authSilent(gasUrl) {
        const self = this;
        return new Promise((resolve, reject) => {
            const iframe = document.createElement('iframe');

            Object.assign(iframe.style, {
                position: 'absolute',
                width: '0px',
                height: '0px',
                border: 'none',
                visibility: 'hidden'
            });

            document.body.appendChild(iframe);
            
            iframe.countdown = (function(time) {
                if(this.timer) clearTimeout(this.timer);
                this.timer = time ? setTimeout(() => {
                    this.remove();
                    reject(null);
                }, time) : null;
            }).bind(iframe);

            iframe.onload = (e) => { iframe.countdown(1000); };

            self.wait2Auth = (data) => {
                iframe.countdown(0);
                iframe.remove();
                resolve(data);
            };

            iframe.src = gasUrl;
            iframe.countdown(10000);
        });
    }

    async authPopup(gasUrl) {
        const self = this;
        return new Promise((resolve, reject) => {
            const popup = window.open(gasUrl, 'Google Drive Login', 'width=510,height=600');
            popup.focus();
            self.wait2Auth = (data) => {
                if (popup && !popup.closed) popup.close();
                resolve(data);
            };
            const timer = setInterval(() => {
              if (!popup || popup.closed) {
                clearInterval(timer);
                resolve(null);
              }
            }, 500);
        });
    }

    async handleAuthClick() {
        if (this.accessToken && this.expiresAt > Date.now()) {
            this.currentPath = [];
            this.fetchFolder('root');
            return;
        }

        this.app.showToast(this.app.i18n ? this.app.i18n.t('gdriveFetchingToken') : '取得授權中...');

        try {
            const gasUrl = 'https://script.google.com/macros/s/AKfycbz-93PY978YMvbZKH7-RDJNsSJVWISnDVkD4ESSvG5bGudMzAUPMagwqB2sJBZwIJ9nWQ/exec?token=' + encodeURIComponent(location.origin);

            const data = (await this.authSilent(gasUrl)) || (await this.authPopup(gasUrl));

            if (data.access_token) {
                this.accessToken = data.access_token;
                this.currentPath = [];
                this.fetchFolder('root');
            } else {
                throw new Error('Failed to get access token');
            }
        } catch (err) {
            console.error('GDrive Auth Error:', err);
            this.app.showToast(this.app.i18n ? this.app.i18n.t('gdriveLoginFail') : '登入失敗');
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
                const buffer = await response.arrayBuffer();
                const text = this.app.decodeText(new Uint8Array(buffer));
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
