import { Action } from "./action.js";

export class ActionClearCache extends Action {
    constructor() {
        super();
    }

    async onActionPerformed(e) {
        const action = e.detail?.action;
        if (action === 'clear-cache' || action === 'clearCache' || action === 'btnClearCache') {
            await this.clear();
        }
    }

    /**
     * 清除 Service Worker 快取與 OPFS 快取
     */
    async clear() {
        if (typeof confirm === 'function' && !confirm('確定要清除所有離線快取嗎？（下次開啟時將需要重新下載模型與資源）')) {
            return;
        }

        let clearedCaches = false;
        try {
            // 1. 清除 CacheStorage 快取
            if (typeof window !== 'undefined' && 'caches' in window) {
                const keys = await window.caches.keys();
                await Promise.all(keys.map(key => window.caches.delete(key)));
                clearedCaches = true;
            }

            // 2. 清除 OPFS 快取 (.cache 資料夾中的快取檔)
            if (window.ZenOPFS && typeof window.ZenOPFS.getCacheDir === 'function') {
                try {
                    const cacheDir = await window.ZenOPFS.getCacheDir();
                    if (cacheDir) {
                        for await (const entry of cacheDir.values()) {
                            await cacheDir.removeEntry(entry.name, { recursive: true });
                        }
                    }
                } catch (e) {
                    console.warn('[ActionClearCache] OPFS cache clear warning:', e);
                }
            }

            this.showToast('離線快取已清除！請重新整理網頁。');
        } catch (err) {
            console.error('[ActionClearCache] Clear cache error:', err);
            this.showToast('清除快取失敗。');
        }
    }

    showToast(message) {
        if (typeof document !== 'undefined' && document.body) {
            document.body.dispatchEvent(new CustomEvent('showInToast', {
                detail: { message, duration: 3500 },
                bubbles: true
            }));
        } else if (window._app && typeof window._app.showToast === 'function') {
            window._app.showToast(message);
        }
    }
}

export const ClearCache = ActionClearCache;
