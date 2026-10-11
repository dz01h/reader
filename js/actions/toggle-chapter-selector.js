import { Action } from "./action.js";

export class ActionToggleChapterSelector extends Action {
    constructor() {
        super();
        this._lastToggleTime = 0;
    }

    onActionPerformed(e) {
        const action = e.detail?.action;
        if (action !== 'toggle-chapter-selector') {
            return;
        }

        const selector = document.querySelector('nav-chapter-selector') || document.getElementById('menu-chapter-selector');
        const btn = e.target?.closest?.('toggle-button') || document.getElementById('btn-toc-toggle');

        if (!selector) return;

        // 以選單實際開關狀態作為 Single Source of Truth
        const shouldOpen = !selector.isOpen;
        this._lastToggleTime = Date.now();

        if (shouldOpen) {
            // 未開啟狀態 -> 開啟選單並更新按鈕狀態
            if (typeof selector.open === 'function') {
                selector.open();
            } else {
                selector.classList.remove('hidden');
                selector.removeAttribute('hidden');
            }
            if (btn) {
                btn.setAttribute('checked', '');
                if (btn.switching) {
                    btn.switching.checked = true;
                }
            }
        } else {
            // 已處於開啟狀態 -> 關閉選單並清除按鈕狀態
            if (typeof selector.close === 'function') {
                selector.close();
            } else {
                selector.classList.add('hidden');
                selector.setAttribute('hidden', '');
            }
            if (btn) {
                btn.removeAttribute('checked');
                if (btn.switching) {
                    btn.switching.checked = false;
                }
            }
        }
    }

    onClick(e) {
        // 防止觸控設備在 pointerup 開啟後，後續延遲合成的 click 事件立刻判定為 outside click 而瞬間關閉
        if (Date.now() - (this._lastToggleTime || 0) < 400) {
            return;
        }

        const selector = document.querySelector('nav-chapter-selector') || document.getElementById('menu-chapter-selector');
        const btn = document.getElementById('btn-toc-toggle') || document.querySelector('toggle-button[action="toggle-chapter-selector"]');

        if (!selector || !selector.isOpen) {
            return;
        }

        const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
        const clickedInsideSelector = selector.contains(e.target) || path.includes(selector);
        const clickedInsideBtn = (btn && (btn.contains(e.target) || path.includes(btn))) ||
            Boolean(e.target?.closest && e.target.closest('#btn-toc-toggle, [action="toggle-chapter-selector"]'));

        if (!clickedInsideSelector && !clickedInsideBtn) {
            if (typeof selector.close === 'function') {
                selector.close();
            } else {
                selector.classList.add('hidden');
                selector.setAttribute('hidden', '');
            }
            if (btn) {
                btn.removeAttribute('checked');
                if (btn.switching) {
                    btn.switching.checked = false;
                }
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
            if (btn) {
                btn.removeAttribute('checked');
                if (btn.switching) {
                    btn.switching.checked = false;
                }
            }
        }
    }
}

export const ToggleChapterSelector = ActionToggleChapterSelector;
