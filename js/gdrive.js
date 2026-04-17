class GDriveModule {
    constructor(app) {
        this.app = app;
        this.SCOPES = 'https://www.googleapis.com/auth/drive.readonly';
        
        this.tokenClient = null;
        this.accessToken = null;
        
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
                this.fetchFiles();
            },
        });

        if (this.accessToken === null) {
            // Trigger OAuth popup
            this.tokenClient.requestAccessToken({prompt: 'consent'});
        } else {
            // Already logged in
            this.fetchFiles();
        }
    }

    async fetchFiles() {
        this.app.showToast(this.app.i18n ? this.app.i18n.t('gdriveFetching') : 'Fetching...');
        try {
            const query = encodeURIComponent("mimeType='text/plain' or mimeType='application/zip'");
            const response = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,mimeType)&pageSize=50`, {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`
                }
            });
            const data = await response.json();
            
            if (data.files && data.files.length > 0) {
                this.showFilePicker(data.files);
            } else {
                this.app.showToast(this.app.i18n ? this.app.i18n.t('gdriveNoFiles') : 'No files found');
            }
        } catch (err) {
            console.error('GDrive Fetch Error:', err);
            this.app.showToast(this.app.i18n ? this.app.i18n.t('gdriveFetchFail') : 'Fetch failed');
        }
    }

    showFilePicker(files) {
        // 先移除已經存在的選擇器
        const existingPicker = document.getElementById('gdrive-file-picker');
        if (existingPicker) existingPicker.remove();

        const picker = document.createElement('div');
        picker.id = 'gdrive-file-picker';
        
        // 這裡套用一些 inline css 做簡單的 UI
        picker.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
            background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);
            z-index: 2000; display: flex; justify-content: center; align-items: center;
        `;

        const listContainer = document.createElement('div');
        listContainer.style.cssText = `
            background: var(--color-surface); padding: 1.5rem; 
            border-radius: var(--radius-lg); width: 90%; max-width: 500px;
            max-height: 80vh; display: flex; flex-direction: column;
            box-shadow: var(--shadow-md); color: var(--color-text);
        `;

        const header = document.createElement('h3');
        header.textContent = this.app.i18n ? this.app.i18n.t('gdrivePickerTitle') : 'Title';
        header.style.marginBottom = '1rem';
        listContainer.appendChild(header);

        const listScroll = document.createElement('div');
        listScroll.style.cssText = 'overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 0.5rem;';

        files.forEach(file => {
            const btn = document.createElement('button');
            // 我們可以共用 app 裡面本來就寫好的 btn-secondary 樣式
            btn.className = 'btn-secondary';
            btn.style.textAlign = 'left';
            btn.style.width = '100%';
            btn.style.whiteSpace = 'nowrap';
            btn.style.overflow = 'hidden';
            btn.style.textOverflow = 'ellipsis';
            
            // 加入副檔名標示
            const typeLabel = file.mimeType === 'application/zip' ? '📁 [ZIP]' : '📄 [TXT]';
            btn.textContent = `${typeLabel} ${file.name}`;
            
            btn.onclick = () => {
                picker.remove();
                this.downloadFile(file.id, file.name, file.mimeType);
            };
            listScroll.appendChild(btn);
        });
        
        listContainer.appendChild(listScroll);

        const closeBtn = document.createElement('button');
        closeBtn.textContent = this.app.i18n ? this.app.i18n.t('gdriveCancel') : 'Cancel';
        closeBtn.className = 'btn-primary';
        closeBtn.style.marginTop = '1.5rem';
        closeBtn.onclick = () => picker.remove();
        
        listContainer.appendChild(closeBtn);
        picker.appendChild(listContainer);
        document.body.appendChild(picker);
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
                this.app.showToast(this.app.i18n ? this.app.i18n.t('gdriveZipDev') : 'ZIP support coming soon.');
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
