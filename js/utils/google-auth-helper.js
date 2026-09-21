/**
 * Google Auth Helper utilities
 * Shared across google-get-token and google-login actions.
 */

export const GOOGLE_GAS_AUTH_URL = 'https://script.google.com/macros/s/AKfycbz-93PY978YMvbZKH7-RDJNsSJVWISnDVkD4ESSvG5bGudMzAUPMagwqB2sJBZwIJ9nWQ/exec?token=' + encodeURIComponent(typeof location !== 'undefined' ? location.origin : '');

/**
 * Validate token using Google's tokeninfo endpoint
 * @param {string} token 
 * @returns {Promise<boolean>}
 */
export async function validateGoogleToken(token) {
    if (!token) return false;
    try {
        const res = await fetch(`https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${encodeURIComponent(token)}`);
        if (res.ok) {
            const data = await res.json();
            if (data && !data.error && data.expires_in > 0) {
                return true;
            }
        }
        return false;
    } catch (err) {
        console.warn('[GoogleAuth] Token validation network error:', err);
        return false;
    }
}

/**
 * Retrieve cached token from _app or localStorage
 * @returns {string|null}
 */
export function getStoredGoogleToken() {
    if (typeof window !== 'undefined' && window._app) {
        if (window._app.gdriveToken) return window._app.gdriveToken;
        if (window._app.accessToken) return window._app.accessToken;
        if (window._app.gdriveAuth && window._app.gdriveAuth.accessToken) return window._app.gdriveAuth.accessToken;
    }
    try {
        const cached = localStorage.getItem('gdrive_auth');
        if (cached) {
            const parsed = JSON.parse(cached);
            if (parsed && parsed.accessToken) {
                return parsed.accessToken;
            }
        }
    } catch (_) {}
    return null;
}

/**
 * Save token to localStorage and window._app
 * @param {string|Object} tokenData 
 * @returns {Object} auth object
 */
export function saveGoogleToken(tokenData) {
    const accessToken = typeof tokenData === 'string' ? tokenData : (tokenData.access_token || tokenData.accessToken);
    const expiresIn = (tokenData && typeof tokenData === 'object' && tokenData.expires_in) ? Number(tokenData.expires_in) : 3600;
    const expiresAt = Date.now() + expiresIn * 1000;

    const authObj = {
        accessToken: accessToken,
        expiresAt: expiresAt
    };

    // Save to localStorage
    try {
        localStorage.setItem('gdrive_auth', JSON.stringify(authObj));
    } catch (_) {}

    // Save to window._app
    if (typeof window !== 'undefined') {
        if (!window._app) window._app = {};
        window._app.gdriveToken = accessToken;
        window._app.accessToken = accessToken;
        window._app.gdriveAuth = authObj;
        if (typeof window._app.updateGoogleUIState === 'function') {
            window._app.updateGoogleUIState();
        }
    }

    return authObj;
}

/**
 * Dispatch GoogleApiReady event to document.body
 * @param {string} accessToken 
 * @param {Object} [extraData] 
 */
export function dispatchGoogleApiReady(accessToken, extraData = {}) {
    const detail = {
        token: accessToken,
        accessToken: accessToken,
        ...extraData
    };
    if (typeof document !== 'undefined' && document.body) {
        const event = typeof CustomEvent !== 'undefined'
            ? new CustomEvent('GoogleApiReady', { detail, bubbles: true })
            : { type: 'GoogleApiReady', detail };
        document.body.dispatchEvent(event.type || 'GoogleApiReady', event);
    }
    return detail;
}

/**
 * Background iframe + GAS token acquisition
 * @param {string} [gasUrl] 
 * @param {number} [timeoutMs] 
 * @returns {Promise<Object>}
 */
export function authSilent(gasUrl = GOOGLE_GAS_AUTH_URL, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        if (typeof document === 'undefined') return reject(new Error('No document'));

        const iframe = document.createElement('iframe');
        Object.assign(iframe.style, {
            position: 'absolute',
            width: '0px',
            height: '0px',
            border: 'none',
            visibility: 'hidden',
            pointerEvents: 'none'
        });

        let timer = null;
        let cleanup = () => {};

        const onMessage = (event) => {
            if (event.origin !== 'https://google.com' && !event.origin?.endsWith('googleusercontent.com') && !event.origin?.endsWith('script.google.com')) return;
            if (event.data && (event.data.type === 'accessToken' || event.data.access_token)) {
                cleanup();
                resolve(event.data);
            }
        };

        cleanup = () => {
            if (timer) clearTimeout(timer);
            window.removeEventListener('message', onMessage);
            if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        };

        window.addEventListener('message', onMessage);
        document.body.appendChild(iframe);

        timer = setTimeout(() => {
            cleanup();
            reject(new Error('Silent auth timeout'));
        }, timeoutMs);

        iframe.src = gasUrl;
    });
}

/**
 * Popup window + GAS interactive login
 * @param {string} [gasUrl] 
 * @param {string} [title] 
 * @param {number} [w] 
 * @param {number} [h] 
 * @returns {Promise<Object>}
 */
export function authPopup(gasUrl = GOOGLE_GAS_AUTH_URL, title = 'Google Drive Login', w = 510, h = 600) {
    return new Promise((resolve, reject) => {
        if (typeof window === 'undefined') return reject(new Error('No window'));

        const popup = window.open(gasUrl, title, `width=${w},height=${h}`);
        if (!popup) {
            return reject(new Error('Popup blocked by browser'));
        }
        popup.focus?.();

        let checkClosedTimer = null;
        let cleanup = () => {};

        const onMessage = (event) => {
            if (event.origin !== 'https://google.com' && !event.origin?.endsWith('googleusercontent.com') && !event.origin?.endsWith('script.google.com')) return;
            if (event.data && (event.data.type === 'accessToken' || event.data.access_token)) {
                cleanup();
                if (popup && !popup.closed) {
                    try { popup.close(); } catch (_) {}
                }
                resolve(event.data);
            }
        };

        cleanup = () => {
            if (checkClosedTimer) clearInterval(checkClosedTimer);
            window.removeEventListener('message', onMessage);
        };

        window.addEventListener('message', onMessage);

        checkClosedTimer = setInterval(() => {
            if (!popup || popup.closed) {
                cleanup();
                resolve(null);
            }
        }, 500);
    });
}
