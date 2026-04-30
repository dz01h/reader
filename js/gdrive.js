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
        window.addEventListener('popstate', this.handlePopState.bind(this));
    }

    async ensureAuth() {
        if (this.accessToken && this.expiresAt > Date.now()) {
            return true;
        }

        // Try to reload from localStorage first
        const cached = localStorage.getItem('gdrive_auth');
        if (cached) {
            try {
                const auth = JSON.parse(cached);
                if (auth.expiresAt > Date.now()) {
                    this.accessToken = auth.accessToken;
                    this.expiresAt = auth.expiresAt;
                    return true;
                }
            } catch(e) {}
        }

        // If we are online, try silent refresh via iframe
        if (navigator.onLine) {
            try {
                const gasUrl = 'https://script.google.com/macros/s/AKfycbz-93PY978YMvbZKH7-RDJNsSJVWISnDVkD4ESSvG5bGudMzAUPMagwqB2sJBZwIJ9nWQ/exec?token=' + encodeURIComponent(location.origin);
                const data = await this.authSilent(gasUrl);
                if (data && data.access_token) {
                    // Tokens are already saved to this and localStorage via handleAuthMessage
                    return true;
                }
            } catch(e) {}
        }

        return false;
    }

    handlePopState(event) {
        if (this.app.explorer) {
            this.app.explorer.saveScrollState();
        }
        if (event.state && event.state.gdrive) {
            this.currentPath = event.state.path || [];
            this.fetchFolder(event.state.folderId, true);
        } else if (this.currentPath && this.currentPath.length > 0) {
            // Popped to a non-gdrive state, reset to root if we were deep in folders
            this.currentPath = [];
            this.fetchFolder('root', true);
        }
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

            const data = (this.accessToken ? (await this.authSilent(gasUrl)) : null) || (await this.authPopup(gasUrl));

            if (data && data.access_token) {
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

    async fetchFolder(folderId, skipPushState = false) {
        if (!skipPushState) {
            const stateObj = {
                gdrive: true,
                folderId: folderId,
                path: JSON.parse(JSON.stringify(this.currentPath))
            };
            history.pushState(stateObj, '', '');
        }

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

            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

            const contentLength = response.headers.get('content-length');
            const total = contentLength ? parseInt(contentLength, 10) : 0;
            let loaded = 0;

            const reader = response.body.getReader();
            const chunks = [];
            let lastUpdate = 0;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                chunks.push(value);
                loaded += value.length;
                
                const now = Date.now();
                if (now - lastUpdate > 100) {
                    lastUpdate = now;
                    if (total) {
                        const percent = Math.round((loaded / total) * 100);
                        this.app.showToast(`下載中... ${percent}%`, 0); // 0 means do not auto-hide
                    } else {
                        const mb = (loaded / 1024 / 1024).toFixed(2);
                        this.app.showToast(`下載中... ${mb} MB`, 0);
                    }
                }
            }
            
            this.app.showToast(`處理中...`, 0);

            // Combine chunks
            const mergedArray = new Uint8Array(loaded);
            let offset = 0;
            for (let chunk of chunks) {
                mergedArray.set(chunk, offset);
                offset += chunk.length;
            }

            if (mimeType === 'application/zip' || fileName.endsWith('.zip')) {
                const blob = new Blob([mergedArray], { type: 'application/zip' });
                if (this.app.zipHandler) {
                    this.app.zipHandler.processZip(blob, fileName);
                } else {
                    this.app.showToast(this.app.i18n ? this.app.i18n.t('gdriveZipDev') : 'ZIP support coming soon.');
                }
            } else {
                const text = this.app.decodeText(mergedArray);
                await this.app.db.saveBook(fileName, text);
                this.app.loadBookIntoReader(fileName, text);
            }
        } catch (err) {
            console.error('Download Error:', err);
            this.app.showToast(this.app.i18n ? this.app.i18n.t('gdriveDownloadFail') : 'Download failed');
        }
    }

    // --- Progress Sync Logic via Google Sheets ---

    async getSheetId() {
        if (this.sheetId) {
            try {
                const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}?fields=spreadsheetId`, {
                    headers: { 'Authorization': `Bearer ${this.accessToken}` }
                });
                if (res.ok) return this.sheetId;
                if (res.status === 404) {
                    this.sheetId = null;
                    localStorage.removeItem('zen_reader_sheet_id');
                }
            } catch(e) {}
        }

        this.sheetId = localStorage.getItem('zen_reader_sheet_id');
        if (this.sheetId) {
           try {
                const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}?fields=spreadsheetId`, {
                    headers: { 'Authorization': `Bearer ${this.accessToken}` }
                });
                if (res.ok) return this.sheetId;
                this.sheetId = null;
                localStorage.removeItem('zen_reader_sheet_id');
           } catch(e) {}
        }

        if (!this.sheetId) {
            try {
                const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
                    method: 'POST',
                    headers: { 
                        'Authorization': `Bearer ${this.accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        properties: { title: "Reading Log" }
                    })
                });
                const data = await res.json();
                if (data.spreadsheetId) {
                    this.sheetId = data.spreadsheetId;
                    localStorage.setItem('zen_reader_sheet_id', this.sheetId);

                    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}:batchUpdate`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${this.accessToken}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            requests: [{
                                updateCells: {
                                    range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 3 },
                                    rows: [{
                                        values: [
                                            { userEnteredValue: { stringValue: "filename" }, userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.95, green: 0.95, blue: 0.95 } } },
                                            { userEnteredValue: { stringValue: "progress" }, userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.95, green: 0.95, blue: 0.95 } } },
                                            { userEnteredValue: { stringValue: "updatedAt" }, userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.95, green: 0.95, blue: 0.95 } } }
                                        ]
                                    }],
                                    fields: "userEnteredValue,userEnteredFormat.textFormat,userEnteredFormat.backgroundColor"
                                }
                            }]
                        })
                    });
                }
            } catch(e) {
                console.error("Failed to create sheet", e);
            }
        }
        return this.sheetId;
    }

    async syncSheetProgress(filename, localProgress, localTimestamp) {
        if (!this.accessToken || this.expiresAt <= Date.now()) {
            const ok = await this.ensureAuth();
            if (!ok) return null;
        }
        const sheetId = await this.getSheetId();
        if (!sheetId) return null;

        let actualSheetId = 0;
        try {
            const infoRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties.sheetId`, {
                headers: { 'Authorization': `Bearer ${this.accessToken}` }
            });
            const info = await infoRes.json();
            if (info.sheets && info.sheets.length > 0) {
                actualSheetId = info.sheets[0].properties.sheetId;
            }
        } catch(e) {}

        let values = [];
        try {
            const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A2:C1001`, {
                headers: { 'Authorization': `Bearer ${this.accessToken}` }
            });
            const data = await res.json();
            values = data.values || [];
        } catch (e) {
            console.error(e);
            return null;
        }

        let foundIndex = -1;
        let remoteProgress = 0.0;
        let remoteTimestamp = "";

        for (let i = 0; i < values.length; i++) {
            if (values[i][0] === filename) {
                foundIndex = i; 
                remoteProgress = parseFloat(values[i][1]) || 0.0;
                remoteTimestamp = values[i][2] || "";
                break;
            }
        }

        const requests = [];
        let needsInsert = false;

        if (foundIndex !== -1) {
            if (foundIndex !== 0) {
                const actualRowIndex = foundIndex + 1; // dimension is 0-indexed, so row actualRowIndex + 1
                requests.push({
                    deleteDimension: {
                        range: { sheetId: actualSheetId, dimension: "ROWS", startIndex: actualRowIndex, endIndex: actualRowIndex + 1 }
                    }
                });
                needsInsert = true;
            }
        } else {
            needsInsert = true;
        }

        if (needsInsert) {
            requests.push({
                insertDimension: {
                    range: { sheetId: actualSheetId, dimension: "ROWS", startIndex: 1, endIndex: 2 },
                    inheritFromBefore: false
                }
            });
            requests.push({
                updateCells: {
                    range: { sheetId: actualSheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 3 },
                    rows: [{
                        values: [
                            { userEnteredValue: { stringValue: filename } },
                            { userEnteredValue: { numberValue: foundIndex !== -1 ? remoteProgress : (localProgress || 0.0) } },
                            { userEnteredValue: { stringValue: foundIndex !== -1 ? remoteTimestamp : (localTimestamp || new Date().toISOString()) } }
                        ]
                    }],
                    fields: "userEnteredValue"
                }
            });
        }

        if (requests.length > 0) {
            try {
                await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ requests })
                });
            } catch (e) {
                console.error("Batch update failed", e);
            }
        }

        if (foundIndex !== -1 && remoteTimestamp) {
            const remoteTime = new Date(remoteTimestamp).getTime();
            const localTime = new Date(localTimestamp).getTime() || 0;
            if (remoteTime > localTime) {
                return { progress: remoteProgress, time: remoteTimestamp };
            }
        }

        return null;
    }

    async updateSheetProgress(filename, progress, timestamp) {
        if (!this.accessToken || this.expiresAt <= Date.now()) {
            const ok = await this.ensureAuth();
            if (!ok) return;
        }
        if (!this.sheetId) {
            this.sheetId = await this.getSheetId();
        }
        if (!this.sheetId) return;

        try {
            await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}/values/A2:C2?valueInputOption=USER_ENTERED`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    values: [[filename, progress, timestamp]]
                })
            });
        } catch (err) {
            console.error('Update Sheet Error:', err);
        }
    }
}

window.ZenGDrive = GDriveModule;
