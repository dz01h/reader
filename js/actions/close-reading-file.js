import { Action } from "./action.js";

export class ActionCloseReadingFile extends Action {
    constructor() {
        super();
        window.addEventListener('popstate', (e) => {
            if (document.body.classList.contains('reading-mode')) {
                if (!e.state || e.state.reading !== true) {
                    this.closeReader(true);
                }
            }
        });
    }

    closeReader(isFromHistory = false) {
        if (window._app?.tts) {
            window._app.tts.stop();
        }

        document.body.classList.remove('reading-mode');
        document.body.classList.remove('ui-hidden');

        if (typeof window._app?.updateThemeColor === 'function') {
            window._app.updateThemeColor();
        }

        if (window._app) {
            window._app.currentBook = null;
        }

        // 發送 ReadingOperation: 'reset' 事件重設 ReadingPanel 與 Navbar 各元件
        document.body.dispatchEvent(new CustomEvent('ReadingOperation', {
            detail: { action: 'reset' },
            bubbles: true
        }));

        if (!isFromHistory) {
            if (history.state && history.state.reading === true) {
                history.back();
            }
        }

        const explorerDialog = document.getElementById('file-explorer-dialog');
        if (explorerDialog && typeof explorerDialog.showModal === 'function') {
            try {
                if (!explorerDialog.open) explorerDialog.showModal();
            } catch (_) {}
        }
    }

    onActionPerformed(e) {
        if (e.detail?.action === 'close-reading-file') {
            this.closeReader(false);
        }
    }
}

export const CloseReadingFile = ActionCloseReadingFile;
