import { Action } from "./action.js";

export class ActionOpenReadingLog extends Action {
    constructor() {
        super();
    }

    async onActionPerformed(e) {
        const action = e.detail?.action;
        if (action === 'open-reading-log' || action === 'openReadingLog' || action === 'btnOpenReadingLog') {
            await this.open();
        }
    }

    /**
     * 開啟 Google Sheets 中的 Reading Log
     */
    async open() {
        let sheetId = localStorage.getItem('zen_reader_sheet_id');

        // If sheetId is not cached locally, attempt to query/create via readingLog service
        if (!sheetId && window._app?.readingLog && typeof window._app.readingLog.getSheetId === 'function') {
            this.showToast('正在尋找或建立 Reading Log...');
            try {
                sheetId = await window._app.readingLog.getSheetId();
            } catch (err) {
                console.error('[ActionOpenReadingLog] getSheetId error:', err);
            }
        }

        if (sheetId) {
            const url = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
            if (typeof window !== 'undefined') {
                window.open(url, '_blank', 'noopener,noreferrer');
            }
        } else {
            this.showToast('尚未建立或找到 Reading Log，請先登入 Google 帳號');
        }
    }

    showToast(message) {
        if (typeof document !== 'undefined' && document.body) {
            document.body.dispatchEvent(new CustomEvent('showInToast', {
                detail: { message, duration: 3000 },
                bubbles: true
            }));
        } else if (window._app && typeof window._app.showToast === 'function') {
            window._app.showToast(message);
        }
    }
}

export const OpenReadingLog = ActionOpenReadingLog;
