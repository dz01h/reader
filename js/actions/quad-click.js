import { Action } from './action.js';

export class ActionQuadClick extends Action {

    mountEvents() {
        document.body.addEventListener('click', e => {
            const panel = e.target.closest('reading-panel') || (e.target.id === 'reading-panel' ? e.target : null);
            if (panel) this.handleClick(e, panel);
        });
    }

    handleClick(e, panel) {
        // Prevent duplicate execution (e.g. synthetic + native click)
        const now = performance.now();
        if (this._lastClickTime && (now - this._lastClickTime < 200)) {
            return;
        }
        this._lastClickTime = now;

        const canvas = panel.canvas || panel.querySelector('canvas') || panel;
        if (!window._app) return;
        const app = window._app;

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Middle 40% toggles UI
        const isMiddleX = x > rect.width * 0.3 && x < rect.width * 0.7;
        const isMiddleY = y > rect.height * 0.3 && y < rect.height * 0.7;

        if (isMiddleX && isMiddleY) {
            document.body.classList.toggle('ui-hidden');
            return;
        }

        const hw = rect.width / 2;
        const hh = rect.height / 2;

        const actionMap = {
            prev: 'prevPage',
            next: 'nextPage'
        };

        let action = 'none';

        if (x < hw && y < hh) action = app.quadTL || 'prev';
        else if (x >= hw && y < hh) action = app.quadTR || 'next';
        else if (x < hw && y >= hh) action = app.quadBL || 'prev';
        else action = app.quadBR || 'next';

        if (actionMap[action]) {
            document.body.dispatchEvent(new CustomEvent('ReadingOperation', { detail: { action: actionMap[action] } }));
        }
    }
}