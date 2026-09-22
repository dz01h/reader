import { Action } from "./action.js";

export class ActionToggleChapterSelector extends Action {
    constructor() {
        super();
    }

    onActionPerformed(e) {
        const action = e.detail?.action;
        if (action !== 'toggle-chapter-selector') {
            return;
        }

        const selector = document.querySelector('nav-chapter-selector') || document.getElementById('menu-chapter-selector');
        const btn = e.target?.closest?.('toggle-button') || document.getElementById('btn-toc-toggle');

        const wasChecked = e.detail?.checked === true;

        if (wasChecked) {
            // 已處於開啟狀態 -> 關閉選單並取消 radio 勾選
            if (btn && btn.switching) {
                btn.switching.checked = false;
            }
            if (btn) {
                btn.removeAttribute('checked');
            }
            if (selector && typeof selector.close === 'function') {
                selector.close();
            } else if (selector) {
                selector.classList.add('hidden');
            }
        } else {
            // 未開啟狀態 -> 開啟選單並確認 radio 勾選
            if (btn && btn.switching) {
                btn.switching.checked = true;
            }
            if (btn) {
                btn.setAttribute('checked', '');
            }
            if (selector && typeof selector.open === 'function') {
                selector.open();
            } else if (selector) {
                selector.classList.remove('hidden');
            }
        }
    }

    onClick(e) {
        const selector = document.querySelector('nav-chapter-selector') || document.getElementById('menu-chapter-selector');
        const btn = document.getElementById('btn-toc-toggle') || document.querySelector('toggle-button[action="toggle-chapter-selector"]');

        if (!selector || selector.classList.contains('hidden') || selector.hasAttribute('hidden')) {
            return;
        }

        const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
        const clickedInsideSelector = selector.contains(e.target) || path.includes(selector);
        const clickedInsideBtn = btn && (btn.contains(e.target) || path.includes(btn));

        if (!clickedInsideSelector && !clickedInsideBtn) {
            if (typeof selector.close === 'function') {
                selector.close();
            } else {
                selector.classList.add('hidden');
            }
            if (btn && btn.switching) {
                btn.switching.checked = false;
            }
            if (btn) {
                btn.removeAttribute('checked');
            }
        }
    }

    onReadingOperation(e) {
        const action = e.detail?.action;
        if (action === 'setProgress' || action === 'reset') {
            const selector = document.querySelector('nav-chapter-selector') || document.getElementById('menu-chapter-selector');
            const btn = document.getElementById('btn-toc-toggle') || document.querySelector('toggle-button[action="toggle-chapter-selector"]');

            if (selector && typeof selector.close === 'function') {
                selector.close();
            }
            if (btn && btn.switching) {
                btn.switching.checked = false;
            }
            if (btn) {
                btn.removeAttribute('checked');
            }
        }
    }
}

export const ToggleChapterSelector = ActionToggleChapterSelector;
