# Zen Reader 開發規範與架構設計指南 (Coding Guidelines)

本文件整理了專案中的核心架構概念、程式碼風格與「防禦性編程反思」。

---

## 1. 核心架構哲學：Action 是串起全場的「訂書針」

> **「在系統設計中，Action 是最後負責把所有東西串起來的訂書針。其他元件都採取『不知道其他元件存在與否』的封閉設計，但 Action 是全知的，准許把手伸進元件去直接操作。也正因如此，為了盡量減少複雜度堆疊與耦合，Action 的功能必須極其單一，並嚴格避免與意圖必要以外的元件接觸。」**

### 架構角色劃分
1. **元件（Components / Panels / UI Elements）—— 盲目但專注**
   - 不知曉其他元件的存在，不直接存取其他元件。
   - 僅透過發射事件（如 `fireEvent('ActionPerformed', ...)` 或自定義事件）表達意圖與狀態變更。
2. **Action —— 全知但克制的訂書針 (Omniscient Stapler)**
   - **全知視角**：被賦予存取 `window._app`、DOM 與各子系統的權限，負責跨元件協調與驅動業務動作。
   - **極簡與單一職責**：只完成單一明確的意圖，絕不越界做不相干的操作，避免將元件間的耦合在 Action 內部重新複雜化。

---

## 2. 拒絕無意義的過度防禦，擁抱 Fail-Fast

在確定為前端瀏覽器 DOM 的環境下，過度撰寫防禦性程式碼（層層檢查全域物件、默默吞掉例外並 fallback）會掩蓋架構問題與 Typo，增加除錯成本。

### ❌ 反面模式 (Anti-Patterns)
1. **在前端 Action / DOM 模組中檢查 `window` 或 `document` 是否存在**
   ```javascript
   // ❌ 沒有必要：Action 均在瀏覽器主執行緒中由 document.body 監聽觸發，不可能跑在 Worker 或非 DOM 環境
   if (typeof window !== 'undefined' && typeof document !== 'undefined') { ... }
   ```
2. **對契約方法使用 `typeof === 'function'` 默默 fallback 或略過**
   ```javascript
   // ❌ 壞處：如果 closeReader 拼錯字或尚未實作，程式會靜默略過，開發者無法第一時間發現 Bug
   if (app && typeof app.closeReader === 'function') {
       app.closeReader();
   }
   ```
3. **在已經掛載事件的 listener 裡檢查宿主物件是否存在**
   ```javascript
   // ❌ onActionPerformed 本身就是掛在 document.body 上才可能被觸發，內部再檢查 document.body 完全多餘
   onActionPerformed(e) {
       if (document && document.body) { ... }
   }
   ```

### ✅ 推薦做法 (Best Practices)
- **直接呼叫應當存在的契約方法**：若 Action 預期呼叫 `closeReader()`，直接寫 `window._app.closeReader()`。若方法缺失，立即噴出 TypeError / Exception，讓開發階段能夠第一時間 Fail-Fast 並定位修正。
- **僅在多態/可選特性（Feature Detection）時做相容性檢查**（例如檢測瀏覽器是否支援特定 Popover API 等）。

```javascript
// ✅ 乾淨俐落、意圖清晰的 Action 寫法
import { Action } from "./action.js";

export class ActionCloseReadingFile extends Action {
    constructor() {
        super();
    }

    onActionPerformed(e) {
        if (e.detail?.action === 'close-reading-file') {
            window._app.closeReader();
        }
    }
}
```

---

## 3. 全域 App 實體存取規範

- **統一存取點**：全域應用程式主實體統一掛載並存取自 `window._app`。
- **淘汰舊有別名**：不再混用 `window.readerApp`、`window.app` 等歷史別名，保持全專案一致性。

---

## 4. Action 註冊與生命週期

1. **由 ActionLoader 自動發現與註冊**：所有繼承自 `Action` 的類別，於 [`js/action-loader.js`](./js/action-loader.js) 的 `actionModules` 清單中註冊即可自動掛載事件監聽。
2. **避免在元件中雙重綁定**：使用 `<action-button action="...">` 的按鈕，統一由 Action 接收 `ActionPerformed` 處理，無需再手動於 `app.js` 綁定 `click` listener。
