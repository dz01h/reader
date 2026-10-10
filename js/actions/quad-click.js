import { Action } from './action.js';

export class ActionQuadClick extends Action {

    mountEvents() {
        document.body.addEventListener('click', e => {
            // 注意：必須嚴格確認 e.target 本身確實是 reading-panel，不可使用 e.target.closest('reading-panel')！
            // 理由：
            // 1. ReadingPanel 僅在非拖曳的單純點擊 (!wasDrag) 時，才會主動對自身發射 target 為 reading-panel 的 click 事件。
            // 2. 若使用 closest('reading-panel') 往上查找，拖曳放開時瀏覽器對 canvas 產生的原生 click，
            //    以及點擊 panel 內部其他子元件、覆蓋層時，都會被誤判為四象限點擊而觸發非預期的翻頁。
            const isReadingPanel = e.target.tagName?.toLowerCase() === 'reading-panel' || e.target.id === 'reading-panel';
            if (isReadingPanel) {
                this.handleClick(e, e.target);
            }
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