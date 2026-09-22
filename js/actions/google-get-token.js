import { Action } from "./action.js";
import { 
    getStoredGoogleAuth,
    getStoredGoogleToken, 
    validateGoogleToken, 
    isTokenExpiringSoon,
    authSilent, 
    saveGoogleToken, 
    dispatchGoogleApiReady 
} from "../utils/google-auth-helper.js";

export class ActionGoogleGetToken extends Action {
    constructor() {
        super();
        this._fetchingPromise = null;
        this._checkInterval = null;
        this._boundOnRefreshRequired = this.onRefreshRequired.bind(this);

        this.initAutoRefresh();
        this.broadcastInitialState();
    }

    mountEvents() {
        super.mountEvents();
        if (typeof document !== 'undefined' && document.body) {
            if (!this._boundOnRefreshRequired) {
                this._boundOnRefreshRequired = this.onRefreshRequired.bind(this);
            }
            document.body.addEventListener('GoogleTokenRefreshRequired', this._boundOnRefreshRequired);
        }
    }

    unmountEvents() {
        super.unmountEvents();
        if (typeof document !== 'undefined' && document.body) {
            document.body.removeEventListener('GoogleTokenRefreshRequired', this._boundOnRefreshRequired);
        }
        if (this._checkInterval) {
            clearInterval(this._checkInterval);
            this._checkInterval = null;
        }
    }

    initAutoRefresh() {
        // Periodic check every 60 seconds for token expiration (refresh if <= 5 minutes remaining)
        if (typeof window !== 'undefined') {
            this._checkInterval = setInterval(() => {
                this.checkExpiryAndAutoRefresh();
            }, 60000);
        }
    }

    /**
     * Fast-path: On startup, if localStorage has an unexpired token, broadcast valid immediately
     */
    broadcastInitialState() {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            this.dispatchTokenStatus('offline', '目前為離線狀態');
            return;
        }

        const auth = getStoredGoogleAuth();
        if (auth && auth.accessToken) {
            const token = getStoredGoogleToken(0);
            if (token) {
                // Token is unexpired locally: fast broadcast valid immediately
                this.dispatchTokenStatus('valid', '已載入本機有效 Token', token);
                dispatchGoogleApiReady(token, auth);

                // If it is expiring within 5 minutes, trigger background refresh
                if (isTokenExpiringSoon(300000)) {
                    console.log('[GoogleGetToken] 本機 Token 接近過期 (5分鐘內)，啟動背景自動換證...');
                    this.getToken({ forceRefresh: true, checkLocalFirst: false }).catch(err => {
                        console.warn('[GoogleGetToken] 背景自動換證異常:', err);
                    });
                }
            } else {
                // Token already expired in storage: trigger renewal
                this.dispatchTokenStatus('testing', 'Token 已過期，嘗試背景換證...');
                this.getToken({ forceRefresh: true, checkLocalFirst: false }).catch(err => {
                    console.warn('[GoogleGetToken] 換證失敗:', err);
                });
            }
        } else {
            this.dispatchTokenStatus('none', '未登入 Google');
        }
    }

    /**
     * Check if token is nearing expiration (< 5 mins) and proactively refresh
     */
    async checkExpiryAndAutoRefresh() {
        if (typeof navigator !== 'undefined' && !navigator.onLine) return;
        const auth = getStoredGoogleAuth();
        if (!auth || !auth.accessToken) return;

        if (isTokenExpiringSoon(300000)) {
            console.log('[GoogleGetToken] 定時檢查：Token 剩餘有效時間不足 5 分鐘，自動執行換證...');
            await this.getToken({ forceRefresh: true, checkLocalFirst: false });
        }
    }

    async onRefreshRequired(e) {
        console.log('[GoogleGetToken] 收到換證請求 (401/過期):', e.detail?.reason || 'manual');
        await this.getToken({ forceRefresh: true, checkLocalFirst: false });
    }

    async onActionPerformed(e) {
        const action = e.detail?.action;
        if (action === 'google-get-token' || action === 'googleGetToken' || action === 'getGoogleToken') {
            const forceRefresh = !!e.detail?.forceRefresh;
            await this.getToken({ forceRefresh });
        }
    }

    /**
     * Get or refresh token with mutex locking to prevent multiple simultaneous refreshes
     * @param {Object} [options]
     * @param {boolean} [options.forceRefresh=false]
     * @param {boolean} [options.checkLocalFirst=true]
     * @returns {Promise<string|null>}
     */
    async getToken(options = {}) {
        const { forceRefresh = false, checkLocalFirst = true } = options;

        // Fast return if local unexpired token is available (> 5 mins left) and not forced
        if (!forceRefresh && checkLocalFirst) {
            const currentToken = getStoredGoogleToken(300000);
            if (currentToken) {
                const auth = getStoredGoogleAuth();
                this.dispatchTokenStatus('valid', 'Token 驗證有效', currentToken);
                dispatchGoogleApiReady(currentToken, auth);
                return currentToken;
            }
        }

        // Mutex lock for in-flight fetch / validation
        if (this._fetchingPromise) {
            return this._fetchingPromise;
        }

        this._fetchingPromise = this._fetchToken(forceRefresh);
        try {
            return await this._fetchingPromise;
        } finally {
            this._fetchingPromise = null;
        }
    }

    dispatchTokenStatus(status, message = '', token = null) {
        if (typeof document !== 'undefined' && document.body) {
            document.body.dispatchEvent(new CustomEvent('GoogleTokenStatus', {
                detail: { status, message, token },
                bubbles: true
            }));
        }
    }

    async _fetchToken(forceRefresh = false) {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            this.dispatchTokenStatus('offline', '目前為離線狀態');
            console.warn('[GoogleGetToken] 目前為離線狀態，無法取得新 token');
            return null;
        }

        // 1. 如果非強制換證，先檢查並驗證現有 token
        if (!forceRefresh) {
            const currentToken = getStoredGoogleToken(0);
            if (currentToken) {
                this.dispatchTokenStatus('testing', '正在驗證現有 Token 有效性...');
                const tokenInfo = await validateGoogleToken(currentToken);
                if (tokenInfo && tokenInfo.valid) {
                    console.log(`[GoogleGetToken] 現有 token 驗證有效 (剩餘: ${tokenInfo.expiresIn} 秒)`);
                    const authObj = saveGoogleToken(currentToken, tokenInfo.expiresIn);
                    this.dispatchTokenStatus('valid', 'Token 驗證有效', currentToken);
                    dispatchGoogleApiReady(currentToken, authObj);
                    return currentToken;
                }
                console.log('[GoogleGetToken] 現有 token 已過期或無效，嘗試背景取得新 token...');
            }
        }

        // 2. 背景 iframe + gas 取得新 token
        this.dispatchTokenStatus('fetching', '正在嘗試取得新 Token...');

        try {
            const data = await authSilent();
            const token = data?.access_token || data?.accessToken;
            if (token) {
                console.log('[GoogleGetToken] 成功透過背景 iframe 取得新 token');
                const authObj = saveGoogleToken(data);
                this.dispatchTokenStatus('valid', '成功取得可用 Token', token);
                dispatchGoogleApiReady(token, authObj);
                return token;
            }
        } catch (err) {
            console.warn('[GoogleGetToken] 背景靜默取得 token 失敗:', err);
        }

        this.dispatchTokenStatus('none', '未取得可用 Token / 授權失效');
        return null;
    }
}

export const GoogleGetToken = ActionGoogleGetToken;
