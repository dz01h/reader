import { Action } from "./action.js";

export class OpenSettingDialog extends Action {
    constructor() {
        super();
    }

    onActionPerformed(e) {
        if(e.detail.action === 'openSettingDialog') {
            document.getElementById('settings-dialog').showModal();
        }
    }
}