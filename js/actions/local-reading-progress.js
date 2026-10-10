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
            timestamp: doc.timestamp || 0,
            saveProgress: (prog, ts = Date.now()) => {
                try {
                    const stateKey = (window.ZenReaderApp && window.ZenReaderApp.STATE_KEY) || 'zen_reader_state';
                    const savedState = localStorage.getItem(stateKey);
                    let state = savedState ? JSON.parse(savedState) : {};
                    if (!state.positions) state.positions = {};
                    state.positions[doc.title] = { progress: prog, ts };
                    localStorage.setItem(stateKey, JSON.stringify(state));
                    if (app) {
                        if (!app.positions) app.positions = {};
                        app.positions[doc.title] = { progress: prog, ts };
                    }
                } catch (e) {
                    console.error("Failed to save progress", e);
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
            if (history.state?.zenModal) {
                history.replaceState({ reading: true }, '', '#reading');
            } else {
                history.pushState({ reading: true }, '', '#reading');
            }
        }
    }

    handleProgressUpdate(e) {
        if (!e.detail) return;
        const progress = e.detail.progress;
        if (typeof progress !== 'number') return;

        const app = window._app;
        if (!app || !app.currentBook) return;

        const now = Date.now();
        app.currentBook.progress = progress;
        app.currentBook.timestamp = now;

        if (typeof app.currentBook.saveProgress === 'function') {
            app.currentBook.saveProgress(progress, now);
        }
    }
}

export const LocalReadingProgress = ActionLocalReadingProgress;
