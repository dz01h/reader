class NavSyncStatus extends Component {
    constructor() {
        super();

        this.tokenStatus = 'none'; // 'none' | 'testing' | 'fetching' | 'valid' | 'offline'
        this.tokenMessage = '未登入 Google';
        this.syncStatus = 'none';   // 'none' | 'syncing' | 'success' | 'error'
        this.syncMessage = '未同步';
        this.lastSyncTime = null;

        this.currentBook = null;
        this.lastSyncTimestamp = 0;
        this.syncCooldownMinutes = 15;

        this.initComponent();
    }

    initComponent() {
        this.classList.add('nav-sync-status');

        this.innerHTML = `
            <div class="nav-sync-container">
                <div class="lamp-group" title="Google API 與雲端進度同步">
                    <span class="status-lamp lamp-token" data-status="none" title="Google 授權狀態"></span>
                    <span class="status-lamp lamp-sync" data-status="none" title="雲端進度同步狀態"></span>
                </div>
                <div class="sync-tooltip">
                    <div class="tooltip-row token-row">
                        <span class="tooltip-label">Token:</span>
                        <span class="tooltip-val token-text">未登入</span>
                    </div>
                    <div class="tooltip-row sync-row">
                        <span class="tooltip-label">同步:</span>
                        <span class="tooltip-val sync-text">未同步</span>
                    </div>
                    <div class="tooltip-row time-row">
                        <span class="tooltip-label">時間:</span>
                        <span class="tooltip-val time-text">-</span>
                    </div>
                </div>
            </div>
        `;

        this.lampToken = this.querySelector('.lamp-token');
        this.lampSync = this.querySelector('.lamp-sync');
        this.tokenText = this.querySelector('.token-text');
        this.syncText = this.querySelector('.sync-text');
        this.timeText = this.querySelector('.time-text');

        this.mountEvents();
        this.checkInitialState();
    }

    mountEvents() {
        // Click on indicator: trigger auth if token invalid, or manual sync if valid
        this.addEventListener('click', () => this.handleClick());

        // Listen for GoogleTokenStatus
        document.body.addEventListener('GoogleTokenStatus', (e) => {
            if (e.detail) {
                this.setTokenStatus(e.detail.status, e.detail.message);
            }
        });

        // Listen for UpdateSyncStatus
        document.body.addEventListener('UpdateSyncStatus', (e) => {
            if (e.detail) {
                this.setSyncStatus(e.detail.status, e.detail.message, e.detail.timestamp);
            }
        });

        // Listen for GoogleApiReady
        document.body.addEventListener('GoogleApiReady', (e) => {
            this.setTokenStatus('valid', 'Token 驗證有效');
            if (this.currentBook && document.body.classList.contains('reading-mode')) {
                this.checkAndSyncCloudProgress();
            }
        });

        // Listen for ReadingOperation ('read' / 'reset')
        document.body.addEventListener('ReadingOperation', (e) => {
            const action = e.detail?.action;
            if (action === 'read' && e.detail.params?.[0]) {
                const doc = e.detail.params[0];
                this.currentBook = {
                    filename: doc.title,
                    progress: doc.progress || 0,
                    timestamp: doc.timestamp || Date.now()
                };
                this.lastSyncTimestamp = 0; // reset cooldown on new book
                
                // Only trigger sync if token is already valid; otherwise wait for GoogleApiReady
                if (this.tokenStatus === 'valid') {
                    this.checkAndSyncCloudProgress();
                } else if (this.tokenStatus === 'none' || this.tokenStatus === 'testing') {
                    this.setSyncStatus('none', '等待 Token 驗證');
                }
            } else if (action === 'reset') {
                this.currentBook = null;
                this.setSyncStatus('none', '未在閱讀中');
            }
        });

        // Listen for ReadingPanelRenderOver to background sync on cooldown
        document.body.addEventListener('ReadingPanelRenderOver', (e) => {
            if (e.detail && typeof e.detail.progress === 'number' && this.currentBook) {
                this.currentBook.progress = e.detail.progress;
                this.handleRenderOverSync(e.detail.progress);
            }
        });

        // Window Lifecycle events
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && this.currentBook && document.body.classList.contains('reading-mode')) {
                this.checkAndSyncCloudProgress();
            }
        });

        window.addEventListener('focus', () => {
            if (this.currentBook && document.body.classList.contains('reading-mode')) {
                this.checkAndSyncCloudProgress();
            }
        });

        window.addEventListener('online', () => {
            this.checkInitialState();
            if (this.currentBook && document.body.classList.contains('reading-mode')) {
                this.checkAndSyncCloudProgress();
            }
        });

        window.addEventListener('offline', () => {
            this.setTokenStatus('offline', '目前為離線狀態');
            this.setSyncStatus('none', '已離線');
        });
    }

    checkInitialState() {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            this.setTokenStatus('offline', '目前為離線狀態');
            this.setSyncStatus('none', '已離線');
            return;
        }

        const helper = window.GoogleAuthHelper;
        const storedToken = helper ? helper.getStoredGoogleToken(0) : null;
        if (storedToken) {
            this.setTokenStatus('valid', '已載入本機有效 Token');
            this.setSyncStatus('none', '未同步');
            return;
        }

        const hasAuth = !!localStorage.getItem('gdrive_auth');
        if (hasAuth) {
            this.setTokenStatus('testing', '正在驗證 Google 授權...');
            this.setSyncStatus('none', '等待 Token 驗證');
            // Trigger ActionGoogleGetToken
            document.body.dispatchEvent(new CustomEvent('ActionPerformed', {
                detail: { action: 'google-get-token' },
                bubbles: true
            }));
        } else {
            this.setTokenStatus('none', '未登入 Google');
            this.setSyncStatus('none', '未登入');
        }
    }

    setTokenStatus(status, message = '') {
        this.tokenStatus = status;
        this.tokenMessage = message || status;

        if (this.lampToken) {
            this.lampToken.setAttribute('data-status', status);
            this.lampToken.title = `Token: ${this.tokenMessage}`;
        }
        if (this.tokenText) {
            this.tokenText.textContent = this.tokenMessage;
        }

        if (status === 'none' || status === 'offline') {
            this.setSyncStatus('none', status === 'offline' ? '已離線' : '未授權');
        }
    }

    setSyncStatus(status, message = '', timestamp = null) {
        this.syncStatus = status;
        this.syncMessage = message || status;
        if (status === 'success') {
            this.lastSyncTime = timestamp || Date.now();
        }

        if (this.lampSync) {
            this.lampSync.setAttribute('data-status', status);
            this.lampSync.title = `同步: ${this.syncMessage}`;
        }
        if (this.syncText) {
            this.syncText.textContent = this.syncMessage;
        }
        if (this.timeText) {
            this.timeText.textContent = this.lastSyncTime
                ? new Date(this.lastSyncTime).toLocaleTimeString()
                : '-';
        }
    }

    async handleClick() {
        if (!navigator.onLine) {
            document.body.dispatchEvent(new CustomEvent('showInToast', {
                detail: { message: '目前為離線狀態，無法同步', duration: 2500 },
                bubbles: true
            }));
            return;
        }

        if (this.tokenStatus !== 'valid') {
            // Trigger Google auth flow
            document.body.dispatchEvent(new CustomEvent('ActionPerformed', {
                detail: { action: 'google-get-token' },
                bubbles: true
            }));
        } else {
            // Trigger manual cloud sync immediately
            await this.checkAndSyncCloudProgress(true);
        }
    }

    async handleRenderOverSync(progress) {
        if (!this.currentBook || this.tokenStatus !== 'valid' || !navigator.onLine) return;
        const app = window._app;
        const cooldown = (app?.syncCooldown ?? this.syncCooldownMinutes) * 60 * 1000;
        const now = Date.now();

        if (now - this.lastSyncTimestamp > cooldown) {
            this.lastSyncTimestamp = now;
            await this.performRemoteSync(this.currentBook.filename, progress);
        } else {
            // Reading progress changed, but throttled by cooldown
            const remainingMins = Math.max(1, Math.ceil((cooldown - (now - this.lastSyncTimestamp)) / 60000));
            this.setSyncStatus('throttled', `進度已變更 (冷卻中，約 ${remainingMins} 分鐘後同步)`);
        }
    }

    async checkAndSyncCloudProgress(force = false) {
        if (!navigator.onLine) {
            this.setTokenStatus('offline', '目前為離線狀態');
            this.setSyncStatus('none', '已離線');
            return;
        }
        if (!this.currentBook) return;

        // Ensure token is valid before starting sync
        if (this.tokenStatus !== 'valid') {
            const helper = window.GoogleAuthHelper;
            if (helper && typeof helper.requestGoogleToken === 'function') {
                const token = await helper.requestGoogleToken({ timeoutMs: 8000 });
                if (!token) {
                    this.setSyncStatus('none', 'Token 不可用');
                    return;
                }
            } else {
                this.setSyncStatus('none', '等待 Token 驗證');
                return;
            }
        }

        const app = window._app;
        const readingLog = app?.readingLog;
        if (!readingLog) return;

        const filename = this.currentBook.filename;
        const localProg = this.currentBook.progress || 0;
        const localTs = this.currentBook.timestamp || Date.now();

        this.setSyncStatus('syncing', '正在比對雲端進度...');

        try {
            const remote = await readingLog.syncSheetProgress(filename, localProg, localTs);
            this.lastSyncTimestamp = Date.now();

            if (remote && remote.progress !== undefined) {
                this.handleRemoteProgress(remote);
            } else {
                await this.performRemoteSync(filename, localProg);
            }
        } catch (err) {
            console.error('[NavSyncStatus] Cloud sync error:', err);
            this.setSyncStatus('error', err.message || '同步出錯');
        }
    }

    handleRemoteProgress(remote) {
        if (!remote || remote.progress === undefined || !this.currentBook) return;

        const currentSavedTs = this.currentBook.timestamp || 0;
        const localProg = this.currentBook.progress || 0;

        // If remote time is older or same, ignore (unless local is 0)
        if (localProg > 0 && new Date(remote.time).getTime() <= currentSavedTs) {
            this.setSyncStatus('success', '進度已為最新');
            return;
        }

        if (confirm(`發現更晚的雲端進度 (${new Date(remote.time).toLocaleString()})\n進度：${(remote.progress * 100).toFixed(2)}%\n是否跳轉？`)) {
            document.body.dispatchEvent(new CustomEvent('ReadingOperation', {
                detail: { action: 'setProgress', params: [remote.progress] },
                bubbles: true
            }));

            this.currentBook.timestamp = new Date(remote.time).getTime();
            this.currentBook.progress = remote.progress;
            if (window.DBService) {
                window.DBService.saveProgress(this.currentBook.filename, remote.progress);
            }
            this.setSyncStatus('success', '已載入雲端最新進度');
        } else {
            // User rejected remote progress. Force overwrite the cloud with current local progress.
            const app = window._app;
            if (app?.readingLog) {
                app.readingLog.updateSheetProgress(
                    this.currentBook.filename,
                    localProg,
                    new Date().toISOString(),
                    true
                );
                document.body.dispatchEvent(new CustomEvent('showInToast', {
                    detail: { message: '已保留本機進度並覆寫雲端', duration: 2500 },
                    bubbles: true
                }));
                this.setSyncStatus('success', '已覆寫雲端進度');
            }
        }
    }

    async performRemoteSync(filename, progress = 0) {
        const app = window._app;
        if (!app?.readingLog) return;
        this.setSyncStatus('syncing', '正在上傳進度...');
        try {
            await app.readingLog.updateSheetProgress(filename, progress, new Date().toISOString());
            this.setSyncStatus('success', '同步成功');
        } catch (err) {
            console.error('[NavSyncStatus] performRemoteSync error:', err);
            this.setSyncStatus('error', err.message || '上傳失敗');
        }
    }
}

if (typeof window !== 'undefined') {
    window.NavSyncStatus = NavSyncStatus;
}
if (typeof customElements !== 'undefined' && !customElements.get('nav-sync-status')) {
    customElements.define('nav-sync-status', NavSyncStatus);
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { NavSyncStatus };
}
