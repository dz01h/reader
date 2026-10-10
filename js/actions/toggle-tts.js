import { Action } from "./action.js";

export class ActionToggleTTS extends Action {
    constructor() {
        super();
    }

    onActionPerformed(e) {
        const action = e.detail?.action;
        if (action === 'toggleTTS' || action === 'toggle-tts' || action === 'btn-tts-toggle') {
            const ttsBtn = document.querySelector('nav-tts-button') || document.getElementById('btn-tts-toggle');
            if (ttsBtn && typeof ttsBtn.toggle === 'function') {
                if (e.target !== ttsBtn) {
                    ttsBtn.toggle();
                }
            }
        }
    }
}

export const ToggleTTS = ActionToggleTTS;
