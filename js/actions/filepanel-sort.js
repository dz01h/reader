import { Action } from "./action.js";

export class ActionFilepanelSort extends Action {
    constructor() {
        super();
    }

    onActionPerformed(e) {
        const action = e.detail?.action;
        if (!action || typeof action !== 'string' || !action.startsWith('filepanel-sort:')) {
            return;
        }

        const sortType = action.slice('filepanel-sort:'.length); // 'name' | 'date' | 'size'
        const target = e.target;

        if (!target) return;

        // 1. If checked was true (already checked button clicked again), toggle ASC <=> DESC
        if (e.detail?.checked === true) {
            const currentVal = (target.value || 'ASC').toUpperCase();
            target.value = currentVal === 'ASC' ? 'DESC' : 'ASC';
        } else {
            // First time switching to this button, ensure it has a valid sort value
            if (!target.value) {
                target.value = (sortType === 'name' ? 'ASC' : 'DESC');
            }
        }

        const sortOrder = (target.value || 'ASC').toUpperCase();

        // 3. Set file-panel sort
        const filePanel = document.querySelector('file-panel');
        if (filePanel && typeof filePanel.setSort === 'function') {
            filePanel.setSort(sortType, sortOrder);
        }
    }
}

export const FilepanelSort = ActionFilepanelSort;
