import { Action } from './actions/action.js';
import { ActionQuadClick } from './actions/quad-click.js';
import { OpenSettingDialog } from './actions/open-setting-dialog.js';
import { ActionFilepanelSort } from './actions/filepanel-sort.js';
import { ActionGoogleGetToken } from './actions/google-get-token.js';
import { ActionGoogleLogin } from './actions/google-login.js';

// 註冊 actions 資料夾中的模組清單
const actionModules = [
    { name: 'quad-click', module: { ActionQuadClick } },
    { name: 'open-setting-dialog', module: { OpenSettingDialog } },
    { name: 'filepanel-sort', module: { ActionFilepanelSort } },
    { name: 'google-get-token', module: { ActionGoogleGetToken } },
    { name: 'google-login', module: { ActionGoogleLogin } }
];

export class ActionLoader {
    constructor() {
        this.actions = new Map();
        this.init();
    }

    /**
     * 初始化並實例化所有 Action 類別
     */
    init() {
        for (const item of actionModules) {
            this.loadModule(item.module, item.name);
        }
    }

    /**
     * 載入特定模組並實例化其中繼承自 Action 的類別
     * @param {Object} moduleExports 模組匯出物件
     * @param {string} [moduleName] 模組名稱
     */
    loadModule(moduleExports, moduleName = 'unknown') {
        for (const [exportName, ExportedItem] of Object.entries(moduleExports)) {
            if (typeof ExportedItem === 'function' && ExportedItem !== Action) {
                // 檢查是否為 Action 的子類別
                if (ExportedItem.prototype instanceof Action || ExportedItem.name.startsWith('Action')) {
                    try {
                        const instance = new ExportedItem();
                        this.actions.set(exportName, instance);
                        console.log(`[ActionLoader] Initialized action: ${exportName} from ${moduleName}`);
                    } catch (err) {
                        console.error(`[ActionLoader] Failed to initialize ${exportName}:`, err);
                    }
                }
            }
        }
    }

    /**
     * 動態載入並註冊單一 Action 類別
     * @param {typeof Action} ActionClass 
     * @param {string} [name] 
     */
    register(ActionClass, name = ActionClass.name) {
        if (typeof ActionClass === 'function') {
            const instance = new ActionClass();
            this.actions.set(name, instance);
            return instance;
        }
    }

    /**
     * 取得已載入的 Action 實例
     * @param {string} name 
     */
    getAction(name) {
        return this.actions.get(name);
    }

    /**
     * 卸載所有 Action 的事件監聽
     */
    destroy() {
        for (const instance of this.actions.values()) {
            if (typeof instance.unmountEvents === 'function') {
                instance.unmountEvents();
            }
        }
        this.actions.clear();
    }
}

// 建立全域 Singleton 實例並掛載至 window
const actionLoader = new ActionLoader();
window.actionLoader = actionLoader;

export default actionLoader;
