class ZenReadingLog {
    constructor(gdrive) {
        this.gdrive = gdrive;
        this.sheetId = localStorage.getItem('zen_reader_sheet_id') || null;
        this.lastSyncTime = 0;
        this.currentBookName = '';
        this.syncCooldown = 15;
        this.isInited = false;
        this.syncing = false;

        document.body.addEventListener('ReadingOver', (e) => {
            this.handleReadingOver(e.detail.prog);
        });
    }

    setReadingBook(filename) {
        this.currentBookName = filename;
        this.resetInit();
    }

    resetInit() {
        this.isInited = false;
        this.lastSyncTime = 0; // Reset timer so it syncs immediately after init
    }

    setCooldown(minutes) {
        this.syncCooldown = minutes;
    }

    async handleReadingOver(prog) {
        if (!this.currentBookName || !navigator.onLine) return;

        if (!this.isInited) {
            if (this.syncing) return;
            const remote = await this.syncSheetProgress(this.currentBookName, prog, new Date().toISOString());
            if (remote) {
                document.body.dispatchEvent(new CustomEvent('readingLog', { detail: remote }));
            }
            return;
        }
        
        const now = Date.now();
        const cooldownMs = (this.syncCooldown || 5) * 60 * 1000;
        
        if (now - this.lastSyncTime > cooldownMs) {
            this.lastSyncTime = now;
            // Background sync
            this.updateSheetProgress(this.currentBookName, prog, new Date().toISOString());
        }
    }

    updateSyncStatus(status, message = '') {
        document.body.dispatchEvent(new CustomEvent('UpdateSyncStatus', { 
            detail: { status, message } 
        }));
    }

    async getSheetId() {
        const token = await this.gdrive.getAccessToken();
        if (!token) return null;

        if(this.sheetId) return this.sheetId;

        this.sheetId = localStorage.getItem('zen_reader_sheet_id');
        if (this.sheetId) {
           try {
                const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}?fields=spreadsheetId`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.ok) return this.sheetId;
                this.sheetId = null;
                localStorage.removeItem('zen_reader_sheet_id');
           } catch(e) {}
        }

        if (!this.sheetId) {
            try {
                // Search for existing Reading Log spreadsheet in the user's Drive
                const q = encodeURIComponent("name = 'Reading Log' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false");
                const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (searchRes.ok) {
                    const searchData = await searchRes.json();
                    if (searchData.files && searchData.files.length > 0) {
                        this.sheetId = searchData.files[0].id;
                        localStorage.setItem('zen_reader_sheet_id', this.sheetId);
                        console.log("Found existing Reading Log sheet:", this.sheetId);
                        return this.sheetId;
                    }
                }
            } catch (e) {
                console.warn("Search for existing sheet failed, will create new one.", e);
            }

            try {
                const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
                    method: 'POST',
                    headers: { 
                        'Authorization': `Bearer ${token}`,
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
                            'Authorization': `Bearer ${token}`,
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
        if (this.syncing) return null;
        this.syncing = true;
        this.updateSyncStatus('syncing');
        
        try {
            const token = await this.gdrive.getAccessToken();
            if (!token) {
                this.updateSyncStatus('error', 'Auth failed');
                return null;
            }

            const sheetId = await this.getSheetId();
            if (!sheetId) {
                this.updateSyncStatus('error', 'Sheet not found');
                return null;
            }

        let actualSheetId = 0;
        try {
            const infoRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties.sheetId`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (infoRes.status === 404) {
                this.sheetId = null;
                localStorage.removeItem('zen_reader_sheet_id');
                this.updateSyncStatus('error', 'Sheet not found (404)');
                return null;
            }
            const info = await infoRes.json();
            if (info.sheets && info.sheets.length > 0) {
                actualSheetId = info.sheets[0].properties.sheetId;
            }
        } catch(e) {
            this.updateSyncStatus('error', 'Failed to get sheet info');
        }

        let values = [];
        try {
            const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A2:C1001`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.status === 404) {
                this.sheetId = null;
                localStorage.removeItem('zen_reader_sheet_id');
                this.updateSyncStatus('error', 'Sheet not found (404)');
                return null;
            }
            const data = await res.json();
            if (!res.ok) throw new Error(data.error?.message || 'Failed to fetch values');
            values = data.values || [];
        } catch (e) {
            console.error(e);
            this.updateSyncStatus('error', e.message);
            return null;
        }

        const matchingIndices = [];
        for (let i = 0; i < values.length; i++) {
            if (values[i][0] === filename) {
                matchingIndices.push(i);
            }
        }

        const requests = [];
        let remoteProgress = localProgress;
        let remoteTimestamp = localTimestamp;
        let foundAny = matchingIndices.length > 0;

        if (foundAny) {
            remoteProgress = parseFloat(values[matchingIndices[0]][1]) || 0.0;
            remoteTimestamp = values[matchingIndices[0]][2] || "";

            // If not already a single row at the top, relocate
            if (!(matchingIndices.length === 1 && matchingIndices[0] === 0)) {
                // Delete all matches from bottom up
                for (let i = matchingIndices.length - 1; i >= 0; i--) {
                    const sheetRowIndex = matchingIndices[i] + 1; 
                    requests.push({
                        deleteDimension: {
                            range: { sheetId: actualSheetId, dimension: "ROWS", startIndex: sheetRowIndex, endIndex: sheetRowIndex + 1 }
                        }
                    });
                }
                // Insert fresh copy at the top
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
                                { userEnteredValue: { numberValue: remoteProgress } },
                                { userEnteredValue: { stringValue: remoteTimestamp } }
                            ]
                        }],
                        fields: "userEnteredValue"
                    }
                });
            }
        } else {
            // New record: insert at top
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
                            { userEnteredValue: { numberValue: localProgress } },
                            { userEnteredValue: { stringValue: localTimestamp || new Date().toISOString() } }
                        ]
                    }],
                    fields: "userEnteredValue"
                }
            });
        }

        if (requests.length > 0) {
            try {
                const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ requests })
                });
                if (res.status === 404) {
                    this.sheetId = null;
                    localStorage.removeItem('zen_reader_sheet_id');
                    this.updateSyncStatus('error', 'Sheet not found (404)');
                    return null;
                }
                if (res.ok) {
                    this.updateSyncStatus('success');
                } else {
                    const errData = await res.json();
                    this.updateSyncStatus('error', errData.error?.message || 'Sync failed');
                }
            } catch (e) {
                console.error("Batch update failed", e);
                this.updateSyncStatus('error', e.message);
            }
        } else {
            this.updateSyncStatus('success');
        }

        if (foundAny && remoteTimestamp) {
            const remoteTime = new Date(remoteTimestamp).getTime();
            const localTime = new Date(localTimestamp).getTime() || 0;
            
            // If local progress is 0, ignore timestamp and prefer cloud progress (if > 0)
            const isLocalEmpty = localProgress === 0;
            const isCloudDifferent = Math.abs(remoteProgress - localProgress) > 0.00001;
            
            if ((isLocalEmpty || remoteTime > localTime) && isCloudDifferent) {
                return { progress: remoteProgress, time: remoteTimestamp };
            }
        }

        } finally {
            this.isInited = true;
            this.syncing = false;
        }

        return null;
    }

    async updateSheetProgress(filename, progress, timestamp) {
        if (!this.isInited || this.syncing) return;
        this.syncing = true;
        this.updateSyncStatus('syncing');

        const token = await this.gdrive.getAccessToken();
        if (!token) {
            this.updateSyncStatus('error', 'Auth failed');
            return;
        }

        const sheetId = await this.getSheetId();
        if (!sheetId) {
            this.updateSyncStatus('error', 'Sheet not found');
            return;
        }

        try {
            const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A2:C2?valueInputOption=USER_ENTERED`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    values: [[filename, progress, timestamp]]
                })
            });
            if (res.status === 404) {
                this.sheetId = null;
                localStorage.removeItem('zen_reader_sheet_id');
                this.updateSyncStatus('error', 'Sheet not found (404)');
                return;
            }
            if (res.ok) {
                this.updateSyncStatus('success');
            } else {
                const errData = await res.json();
                this.updateSyncStatus('error', errData.error?.message || 'Update failed');
            }
        } catch (err) {
            console.error('Update Sheet Error:', err);
            this.updateSyncStatus('error', err.message);
        } finally {
            this.syncing = false;
        }
    }
}

window.ZenReadingLog = ZenReadingLog;
