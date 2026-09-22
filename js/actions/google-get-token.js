import { Action } from "./action.js";
import { 
    getStoredGoogleToken, 
    validateGoogleToken, 
    authSilent, 
    saveGoogleToken, 
    dispatchGoogleApiReady 
} from "../utils/google-auth-helper.js";

export class ActionGoogleGetToken extends Action {
    constructor() {
        super();
        this._fetchingPromise = null;
    }

    async onActionPerformed(e) {
        const action = e.detail?.action;
        if (action === 'google-get-token' || action === 'googleGetToken' || action === 'getGoogleToken') {
            await this.getToken();
        }
    }

    /**
     * 1) 假設 _app 裡面有之前儲存的token，嘗試 call api 確認 token 可以使用。
     * 2) 如果沒有token或不能使用，請走之前iframe + gas的方式在背景取得新的token。
     * 3) 完成2的動作請發一個 event 宣告 可以使用 gapi (帶著token)，同時更新 _app裡面儲存的token
     * @returns {Promise<string|null>}
     */
    async getToken() {
        if (this._fetchingPromise) {
            return this._fetchingPromise;
        }

        this._fetchingPromise = this._fetchToken();
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

    async _fetchToken() {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            this.dispatchTokenStatus('offline', '目前為離線狀態');
            console.warn('[GoogleGetToken] 目前為離線狀態，無法取得新 token');
            return null;
        }

        // 1. 檢查現有 token
        const currentToken = getStoredGoogleToken();
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

        // 2. 背景 iframe + gas 取得新 token
        this.dispatchTokenStatus('fetching', '正在嘗試取得新 Token...');

        try {
            const data = await authSilent();
            const token = data?.access_token || data?.accessToken;
            if (token) {
                console.log('[GoogleGetToken] 成功透過背景 iframe 取得新 token');
                // 3. 更新 _app 並發布事件
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
