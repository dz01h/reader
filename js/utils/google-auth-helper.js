/**
 * Google Auth Helper utilities
 * Shared across google-get-token and google-login actions.
 */

export const GOOGLE_GAS_AUTH_URL = 'https://script.google.com/macros/s/AKfycbz-93PY978YMvbZKH7-RDJNsSJVWISnDVkD4ESSvG5bGudMzAUPMagwqB2sJBZwIJ9nWQ/exec?token=' + encodeURIComponent(typeof location !== 'undefined' ? location.origin : '');

/**
 * Validate token using Google's tokeninfo endpoint
 * @param {string} token 
 * @returns {Promise<{valid: boolean, expiresIn: number, expiresAt: number, data: Object}|null>}
 */
export async function validateGoogleToken(token) {
    if (!token) return null;
    try {
        const res = await fetch(`https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${encodeURIComponent(token)}`);
        if (res.ok) {
            const data = await res.json();
            if (data && !data.error && data.expires_in > 0) {
                const expiresIn = Number(data.expires_in);
                return {
                    valid: true,
                    expiresIn: expiresIn,
                    expiresAt: Date.now() + expiresIn * 1000,
                    data: data
                };
            }
        }
        return null;
    } catch (err) {
        console.warn('[GoogleAuth] Token validation network error:', err);
        return null;
    }
}

/**
 * Retrieve cached auth object from _app or localStorage
 * @returns {{accessToken: string, expiresIn?: number, expiresAt?: number}|null}
 */
export function getStoredGoogleAuth() {
    if (typeof window !== 'undefined' && window._app) {
        if (window._app.gdriveToken && window._app.gdriveAuth?.accessToken && window._app.gdriveToken !== window._app.gdriveAuth.accessToken) {
            return {
                accessToken: window._app.gdriveToken,
                expiresAt: window._app.expiresAt || 0,
                expiresIn: window._app.expiresIn || 0
            };
        }
        if (window._app.gdriveAuth && window._app.gdriveAuth.accessToken) {
            return window._app.gdriveAuth;
        }
        if (window._app.gdriveToken || window._app.accessToken) {
            return {
                accessToken: window._app.gdriveToken || window._app.accessToken,
                expiresAt: window._app.expiresAt || 0,
                expiresIn: window._app.expiresIn || 0
            };
        }
    }
    try {
        const cached = localStorage.getItem('gdrive_auth');
        if (cached) {
            const parsed = JSON.parse(cached);
            if (parsed && parsed.accessToken) {
                return parsed;
            }
        }
    } catch (_) {}
    return null;
}

/**
 * Retrieve cached token string if valid / not expired
 * @param {number} [bufferMs=180000] Buffer in milliseconds (default 3 mins) to treat as expired early
 * @returns {string|null}
 */
export function getStoredGoogleToken(bufferMs = 180000) {
    const auth = getStoredGoogleAuth();
    if (!auth || !auth.accessToken) return null;

    // Check if expiresAt exists and is expired or close to expiry (within bufferMs)
    if (auth.expiresAt && typeof auth.expiresAt === 'number' && auth.expiresAt > 0) {
        if (Date.now() + bufferMs >= auth.expiresAt) {
            console.log('[GoogleAuth] Stored token has expired or is expiring soon (within buffer)');
            return null;
        }
    }

    return auth.accessToken;
}

/**
 * Save token to localStorage and window._app with expiration details
 * @param {string|Object} tokenData 
 * @param {number} [customExpiresIn]
 * @returns {{accessToken: string, expiresIn: number, expiresAt: number}} auth object
 */
export function saveGoogleToken(tokenData, customExpiresIn = null) {
    const accessToken = typeof tokenData === 'string' ? tokenData : (tokenData.access_token || tokenData.accessToken);
    
    let expiresIn = 3600;
    if (customExpiresIn !== null && !isNaN(customExpiresIn)) {
        expiresIn = Number(customExpiresIn);
    } else if (tokenData && typeof tokenData === 'object') {
        if (tokenData.expires_in !== undefined) expiresIn = Number(tokenData.expires_in);
        else if (tokenData.expiresIn !== undefined) expiresIn = Number(tokenData.expiresIn);
    }

    let expiresAt = Date.now() + expiresIn * 1000;
    if (tokenData && typeof tokenData === 'object' && tokenData.expiresAt && typeof tokenData.expiresAt === 'number') {
        expiresAt = tokenData.expiresAt;
    }

    const authObj = {
        accessToken: accessToken,
        expiresIn: expiresIn,
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
        window._app.expiresAt = expiresAt;
        window._app.expiresIn = expiresIn;
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
    const auth = (typeof window !== 'undefined' && window._app?.gdriveAuth) || {};
    const detail = {
        token: accessToken,
        accessToken: accessToken,
        expiresIn: extraData.expiresIn ?? extraData.expires_in ?? auth.expiresIn ?? 3600,
        expiresAt: extraData.expiresAt ?? auth.expiresAt ?? (Date.now() + 3600 * 1000),
        ...extraData
    };
    if (typeof document !== 'undefined' && document.body) {
        const event = typeof CustomEvent !== 'undefined'
            ? new CustomEvent('GoogleApiReady', { detail, bubbles: true })
            : { type: 'GoogleApiReady', detail };
        document.body.dispatchEvent(event);
    }
    return detail;
}

/**
 * Request Google token by dispatching the 'google-get-token' action
 * and waiting for the GoogleApiReady broadcast event.
 * @param {number} [timeoutMs=15000]
 * @returns {Promise<string|null>}
 */
export function requestGoogleToken(timeoutMs = 15000) {
    return new Promise((resolve) => {
        let timer = null;
        const onReady = (e) => {
            if (timer) clearTimeout(timer);
            if (typeof document !== 'undefined' && document.body) {
                document.body.removeEventListener('GoogleApiReady', onReady);
            }
            const token = e.detail?.accessToken || e.detail?.token || null;
            resolve(token);
        };

        if (typeof document !== 'undefined' && document.body) {
            document.body.addEventListener('GoogleApiReady', onReady);
            document.body.dispatchEvent(new CustomEvent('ActionPerformed', {
                detail: { action: 'google-get-token' },
                bubbles: true
            }));
        } else {
            resolve(getStoredGoogleToken());
            return;
        }

        timer = setTimeout(() => {
            if (typeof document !== 'undefined' && document.body) {
                document.body.removeEventListener('GoogleApiReady', onReady);
            }
            resolve(getStoredGoogleToken());
        }, timeoutMs);
    });
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

if (typeof window !== 'undefined') {
    window.GoogleAuthHelper = {
        GOOGLE_GAS_AUTH_URL,
        validateGoogleToken,
        getStoredGoogleAuth,
        getStoredGoogleToken,
        requestGoogleToken,
        saveGoogleToken,
        dispatchGoogleApiReady,
        authSilent,
        authPopup
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        GOOGLE_GAS_AUTH_URL,
        validateGoogleToken,
        getStoredGoogleAuth,
        getStoredGoogleToken,
        requestGoogleToken,
        saveGoogleToken,
        dispatchGoogleApiReady,
        authSilent,
        authPopup
    };
}
