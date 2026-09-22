import { Action } from './action.js';

export class ActionLocalReadingProgress extends Action {
    mountEvents() {
        this._renderHandler = (e) => this.handleProgressUpdate(e);
        this._readHandler = (e) => {
            if (e.detail?.action === 'read' && e.detail.params?.[0]) {
                this.handleDocumentRead(e.detail.params[0]);
            }
        };

        document.body.addEventListener('ReadingPanelRenderOver', this._renderHandler);
        document.body.addEventListener('ReadingOperation', this._readHandler);
    }

    unmountEvents() {
        if (this._renderHandler) {
            document.body.removeEventListener('ReadingPanelRenderOver', this._renderHandler);
        }
        if (this._readHandler) {
            document.body.removeEventListener('ReadingOperation', this._readHandler);
        }
    }

    handleDocumentRead(doc) {
        const app = window._app;
        if (!app) return;

        app.currentBook = {
            filename: doc.title,
            content: doc.rawText,
            progress: doc.progress || 0,
            saveProgress: (prog) => {
                if (window.DBService) {
                    window.DBService.saveProgress(doc.title, prog);
                }
            }
        };
        app.saveState({ lastBookId: doc.title });

        if (app.readingLog) {
            app.readingLog.setReadingBook(doc.title);
            app.readingLog.setCooldown(app.syncCooldown);
        }

        document.body.classList.add('reading-mode');
        document.body.classList.remove('ui-hidden');
        if (typeof app.updateThemeColor === 'function') {
            app.updateThemeColor();
        }

        if (!history.state || history.state.reading !== true) {
            history.pushState({ reading: true }, '', '#reading');
        }
    }

    handleProgressUpdate(e) {
        if (!e.detail) return;
        const progress = e.detail.progress;
        if (typeof progress !== 'number') return;

        const app = window._app;
        if (!app || !app.currentBook) return;

        app.currentBook.progress = progress;
        app.currentBook.timestamp = Date.now();

        if (typeof app.currentBook.saveProgress === 'function') {
            app.currentBook.saveProgress(progress);
        } else if (window.DBService && app.currentBook.filename) {
            window.DBService.saveProgress(app.currentBook.filename, progress);
        }
    }
}

export const LocalReadingProgress = ActionLocalReadingProgress;
