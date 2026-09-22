import { Action } from "./action.js";

export class ActionOpenExplorerDialog extends Action {
    constructor() {
        super();
    }

    onActionPerformed(e) {
        if (e.detail?.action === 'open-explorer-dialog') {
            const explorerDialog = document.getElementById('file-explorer-dialog');
            if (explorerDialog && typeof explorerDialog.showModal === 'function') {
                try {
                    if (!explorerDialog.open) explorerDialog.showModal();
                } catch (_) {}
            }
        }
    }
}

export const OpenExplorerDialog = ActionOpenExplorerDialog;
