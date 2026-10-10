import { Action } from "./action.js";

/**
 * ActionMobileBack
 * Links mobile / browser "Back" navigation with the File Explorer and application dialogs.
 * - Subfolder navigation in File Explorer: Back button returns to the parent folder and restores scroll position.
 * - Root level of File Explorer: Back button closes the explorer dialog.
 * - Settings and other dialogs: Back button closes the open dialog.
 */
export class ActionMobileBack extends Action {
    constructor() {
        super();
        this._historyDepth = 0;
        this._isHandlingPop = false;
        this._ignorePopCount = 0;
        this._dialogObservers = new Map();

        this.initDialogTracking();
    }

    initDialogTracking() {
        const dialogIds = ['file-explorer-dialog', 'settings-dialog', 'error-log-dialog'];
        for (const id of dialogIds) {
            const dialog = document.getElementById(id);
            if (!dialog) continue;

            const observer = new MutationObserver((mutations) => {
                for (const m of mutations) {
                    if (m.type === 'attributes' && m.attributeName === 'open') {
                        if (dialog.open) {
                            this.onDialogOpened(dialog);
                        }
                    }
                }
            });
            observer.observe(dialog, { attributes: true, attributeFilter: ['open'] });
            this._dialogObservers.set(dialog, observer);

            dialog.addEventListener('close', () => {
                this.onDialogClosed(dialog);
            });
        }
    }

    onDialogOpened(dialog) {
        if (this._isHandlingPop) return;
        history.pushState({ zenModal: dialog.id, depth: 0 }, '');
        this._historyDepth = 1;
    }

    onReadingOperation(e) {
        if (e.detail?.action === 'read') {
            // When opening a book to read, transition away from modal without unwinding history
            this._historyDepth = 0;
        }
    }

    onDialogClosed(dialog) {
        if (this._isHandlingPop) return;
        if (this._historyDepth > 0) {
            const count = this._historyDepth;
            this._historyDepth = 0;
            this._ignorePopCount += count;
            history.go(-count);
        }
    }

    onFileFolderNavigated(e) {
        if (this._isHandlingPop) return;
        const dialog = document.getElementById('file-explorer-dialog');
        if (!dialog || !dialog.open) return;

        const { direction, fromDepth, toDepth } = e.detail || {};
        if (direction === 'forward') {
            history.pushState({ zenModal: 'file-explorer', depth: toDepth }, '');
            this._historyDepth++;
        } else if (direction === 'back') {
            const diff = Math.max(0, fromDepth - toDepth);
            if (diff > 0 && this._historyDepth > 1) {
                const unwindCount = Math.min(diff, this._historyDepth - 1);
                this._ignorePopCount += unwindCount;
                this._historyDepth -= unwindCount;
                history.go(-unwindCount);
            }
        }
    }

    async onPopState(e) {
        if (this._ignorePopCount > 0) {
            this._ignorePopCount--;
            return;
        }

        this._isHandlingPop = true;
        try {
            // 1. Check file-explorer-dialog
            const explorerDialog = document.getElementById('file-explorer-dialog');
            if (explorerDialog && explorerDialog.open) {
                const filePanel = explorerDialog.querySelector('file-panel');
                if (filePanel && typeof filePanel.navigateBack === 'function') {
                    const navigated = await filePanel.navigateBack();
                    if (navigated) {
                        this._historyDepth = Math.max(1, this._historyDepth - 1);
                        return;
                    }
                }
                // At root, close explorer dialog
                this._historyDepth = 0;
                explorerDialog.close();
                return;
            }

            // 2. Check settings-dialog
            const settingsDialog = document.getElementById('settings-dialog');
            if (settingsDialog && settingsDialog.open) {
                this._historyDepth = 0;
                settingsDialog.close();
                return;
            }

            // 3. Check error-log-dialog
            const errorLogDialog = document.getElementById('error-log-dialog');
            if (errorLogDialog && errorLogDialog.open) {
                this._historyDepth = 0;
                errorLogDialog.close();
                return;
            }
        } finally {
            this._isHandlingPop = false;
        }
    }
}

export const MobileBack = ActionMobileBack;
