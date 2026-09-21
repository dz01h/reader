import { Action } from "./action.js";
import { 
    authPopup, 
    saveGoogleToken, 
    dispatchGoogleApiReady 
} from "../utils/google-auth-helper.js";

export class ActionGoogleLogin extends Action {
    constructor() {
        super();
    }

    async onActionPerformed(e) {
        const action = e.detail?.action;
        if (action === 'google-login' || action === 'googleLogin' || action === 'btnGoogleLogin' || action === 'btnGasAuth') {
            await this.login();
        }
    }

    /**
     * 1) 用 window open 開子視窗要求瀏覽器的google登入。
     * 2) 結束後關閉子視窗，發同個event (GoogleApiReady)
     * @returns {Promise<string|null>}
     */
    async login() {
        if (window._app && typeof window._app.showToast === 'function') {
            window._app.showToast('正在開啟 Google 登入視窗...');
        }

        try {
            const data = await authPopup();
            const token = data?.access_token || data?.accessToken;
            if (token) {
                console.log('[GoogleLogin] Google 登入成功');
                saveGoogleToken(data);
                dispatchGoogleApiReady(token, data);
                if (window._app && typeof window._app.showToast === 'function') {
                    window._app.showToast('Google 登入授權成功！');
                }
                return token;
            } else {
                console.warn('[GoogleLogin] 登入視窗已關閉或未取得 token');
                return null;
            }
        } catch (err) {
            console.error('[GoogleLogin] Google 登入失敗:', err);
            if (window._app && typeof window._app.showToast === 'function') {
                window._app.showToast('Google 登入失敗或已取消');
            }
            return null;
        }
    }
}

export const GoogleLogin = ActionGoogleLogin;
