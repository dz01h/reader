# ZenTTS 架構與流程規格

ZenTTS 是一個設計用來提供跨頁無縫銜接（Gapless Playback）的離線語音朗讀系統。系統被深度解耦為「流程控制與播放（Controller）」與「語音合成（Engine）」兩個獨立部分，透過事件驅動（Event-Driven）的方式進行溝通。

## 系統架構

系統主要由三個核心元件組成：

1.  **ZenTTS (Controller & Playback - `js/tts.js`)**
    *   **職責**：管理朗讀流程（暫停、播放、換頁）、AudioContext 音訊排程、MediaSession 整合，以及維持系統喚醒。
    *   **特點**：不涉及任何語音合成邏輯，只負責「接收音訊」並「精準排程播放」。

2.  **ZenTTSPiper (Synthesis Engine - `js/tts/piper.js`)**
    *   **職責**：將 Controller 傳來的文字片段（Chunks）分配給背後的 Worker Pool 進行合成。
    *   **特點**：管理多執行緒合成任務，處理簡繁轉換與 ONNX 模型的呼叫。

3.  **PiperWorker (`js/tts/piper-worker.js`)**
    *   **職責**：實際執行 VITSWeb 的 WebAssembly/ONNX 推理，產生 PCM 音訊數據 (ArrayBuffer)。

## 事件溝通協定 (Event Protocol)

Controller、Engine 與 ReadingPanel 之間完全透過 `document.body` 上的 CustomEvent 進行通訊：

*   **Controller -> Engine**
    *   `ZenTTSPiper:Enqueue`：要求 Engine 開始合成一段文字。
        *   `detail: { chunks: Array<string>, voiceId: string, isAppend: boolean }`
        *   `isAppend` 決定是開啟新的合成會話（清空舊任務），還是將新任務接續在目前會話之後。
    *   `ZenTTSPiper:Clear`：要求 Engine 停止目前的合成任務。
        *   `detail: { hard: boolean }`
        *   `hard=true` 會直接 Terminate Worker 來立刻釋放資源（通常用於手動強制換頁）。

*   **Engine -> Controller**
    *   `ZenTTS:ChunkPlaying`：通知 Controller 某一句子即將開始播放，Controller 據此更新 MediaSession metadata。
        *   `detail: { text: string }`

*   **Controller -> ReadingPanel**
    *   `ReadingOperation`：要求閱讀面板執行特定的 UI/版面動作。
        *   `detail: { action: 'nextPage' | 'prevPage' | 'requestReadingOver' }`
        *   `requestReadingOver` 用於強制要求 ReadingPanel 立即拋出 `ReadingOver` 事件（通常在無 Chunks 卻點下播放鍵時觸發）。

*   **ReadingPanel -> Controller**
    *   `ReadingOver`：拋出當前頁面與下一頁預加載的文字資訊。
        *   `detail: { reading: string, nextReading: string, prog: number }`

## 核心工作流程

### 1. 播放與排程 (Gapless Playback)
*   **背景喚醒**：`ZenTTS` 會創建一個隱藏的 `<audio>` 標籤（`this.audioPlayer`），持續循環播放一段短暫的無聲 WAV（44.1kHz）。這能確保行動裝置在鎖定畫面時不會暫停瀏覽器的音訊處理，同時也能讓 MediaSession 正確綁定。
*   **精確排程**：接收到的 `AudioData` 會被解碼並排入 `AudioContext` 隊列（`_scheduleBuffer`）。
    *   利用 `this.nextStartTime` 計算每個片段的精確播放時間點，達到無縫銜接。
    *   每個片段頭尾加入 5ms 的極短淡入淡出（Fade In/Out），消除音訊拼接可能產生的「喀噠」爆音。
    *   所有音訊經過 `DynamicsCompressorNode`，防止音量過載。

### 2. 暫停與恢復 (Pause / Resume)
*   **暫停 (`pause`)**：呼叫 `AudioContext.suspend()`。AudioContext 時間軸凍結後，已排程的 `AudioBufferSourceNode` 不會觸發 `onended`，因此 `speak()` 的 Promise 會持續被 `await` 住，`playCurrentPage` 的 `while` 迴圈自然暫停等待。
*   **恢復 (`resume`)**：呼叫 `AudioContext.resume()`。時間軸解凍後，被凍住的 `onended` 重新觸發，`speak()` Promise resolve，`while` 迴圈從斷點繼續往下執行。**無需重新呼叫 `playCurrentPage()`**，整個流程天然正確。

### 3. 自動換頁預載 (Auto Page Turn)
*   當 Engine 回傳 `ChunkDone`，且 `nextFlushIdx >= totalChunks` 時（代表該頁最後一句已經合成完並送入排程），觸發 `requestNextPage()`。
*   `ReadingPanel` 會翻到下一頁並發出 `ReadingOver` 事件。
*   `ZenTTS` 比較 `_lastReadingText`，確認文字更新後，擷取**新頁面的 Chunks**，並發出 `ZenTTSPiper:Enqueue`（`isAppend: true`）。
*   Engine 將新任務追加到隊列末端，AudioContext 不中斷，達成完美的跨頁無縫朗讀。

### 4. 手動換頁打斷 (Manual Interrupt)
*   如果使用者在朗讀時手動滑動/點擊換頁，`ReadingOver` 事件觸發。
*   `ZenTTS` 發現這是手動行為（非 `isWaitingForNextPage`），則呼叫 `_resetAndPlayCurrentPage()`。
*   發出 `ZenTTSPiper:Clear`（`hard: true`），立刻殺死並重建 Worker 來釋放 GPU/CPU。
*   清空 AudioContext 隊列，並針對新頁面的文字重新發出 `Enqueue`（`isAppend: false`）。

## 離線支援 (Offline Capabilities)

透過 Service Worker (v9) 的深度快取策略，系統支援完全離線的 TTS 運作：
1.  **同源資源 (Same-Origin)**：使用 Stale-While-Revalidate 策略。
2.  **CDN 資源 (jsDelivr)**：包含 WASM 執行檔與 Phonemize 字典檔（`piper_phonemize.data`），使用 Cache-First 策略以確保斷網時不會觸發 `NetworkError`。
3.  **語音模型 (ONNX)**：由 `VITSWeb` 內部邏輯自動存入瀏覽器的 IndexedDB。

---

---

## 🏗️ [Draft] 新架構提案：以 Chunks 為中心的統一介面與 VoicePool

為了徹底解耦並輕鬆抽換不同的 TTS 引擎（Piper vs Web Speech API），我們將採用以 `Chunks` 為發聲主體的迴圈架構，並透過 `VoicePool` 解決非同步與效能問題。

### 1. 職責重分配

* **ZenTTS (Controller)**
  * 負責監聽 UI 與 `ReadingOver`。不處理 `AudioContext`，也不處理合成。
  * `ReadingOver` 事件將擴充，同時帶有 `currentPage` 與預先抓取的 `nextPage` 內容。
  * 負責維護一個簡單的非同步 `while` 迴圈來呼叫 `chunks.speak()`。
  * **節能惰性加載 (Battery-Saving Lazy Init)**：在 TTS 完全停止（非播放、非暫停）的狀態下，即使收到 `ReadingOver` 也**完全不調用 `prepare()`**，讓 Worker 完全靜止以節省電量。當播放鍵按下且 `this.chunks` 為空時，會向 ReadingPanel 發送 `requestReadingOver` 事件觸發即時重新渲染與資料載入，隨後自動開啟播放。

* **TTSEngine (Piper / WebSpeech)**
  * 提供 `prepare(readingData)` 方法，直接接收 `ReadingOver` 的 event data（包含目前頁面與下一頁的文字）。
  * 引擎負責將文字拆解為獨立的句段（Chunk keys），並產出對應的 `Chunks` 物件。**引擎的拆解邏輯與 Chunks 內部必須完全一致**，確保對應的 key 吻合。
  * **(Piper 專屬) VoicePool 管理與 Worker 排程**：
    * 維護一個 `VoicePool` (Key-Value map)，將句段文字映射到算好的 AudioBuffer。
    * **排程**：Worker manager 只需不斷掃描 `VoicePool` 中「尚未擁有音訊資料」的 key，並將其派發給閒置的 Worker 計算。
    * **延遲清理快取 (Lazy Cache Cleanup)**：為了避免使用者在暫停/重播/倒退時需要重新合成語音造成耗電與卡頓，播放完畢時**不**會立即刪除 `VoicePool` 內部的語音資料。所有的快取清理與記憶體釋放統一延後至 `prepare()` 階段，伴隨跳頁或翻頁時比對新舊 `allNeededKeys` 自動進行 GC 清理。
    * **跳頁清理與順序重排 (Garbage Collection & Reordering)**：當收到新的 `ReadingOver` 呼叫 `prepare()` 時，必須按照新 `allNeededKeys` 的順序（目前頁面的 Chunks 在前，下一頁的 Chunks 在後）重新建構 `VoicePool`。未被播放且不再出現在新 keys 中的舊資料會被自動 GC 刪除；而仍在保留名單中的舊資料與新增的 pending 任務，則會按照新順序在 Map 中重排（利用 JS Map 保留插入順序的特性）。這能確保 Worker 掃描排程時，百分之百優先合成當前頁面急需播放的語音，極大化縮短首字播放延遲。

* **Chunks (執行者)**
  * 實作 `async speak()` 方法。負責「發聲」與「流程等待」。

### 2. ZenTTS 的主迴圈設計

更新後的播放邏輯更簡潔強健，由 `ZenTTS` 監聽並驅動：

```javascript
// ZenTTS 內部的播放邏輯
async playCurrentPage() {
    this.isPlaying = true;
    while (this.isPlaying && this.chunks.hasNext()) {
        // 呼叫 chunks.speak()，它會負責發聲並「等待適當的時間」才 resolve
        await this.chunks.speak();
    }
    
    // 當整頁的 chunks 都 speak 完畢
    if (this.isPlaying) {
        this.requestNextPage(); // 觸發翻頁
    }
}
```

### 3. 簡化的自然停頓與清理時機 (Natural Pacing & Cleanup)

我們放棄了刻意追求極致的「無縫銜接 (Gapless) 排程」。因為 `Chunks` 已經是依照標點符號（逗號、句號等）進行切割的，句子之間本來就需要短暫的停頓。
因此，`speak()` 的 resolve 時機點應該設定在**聲音確實播放完畢時**。這帶來的極大好處是：**完美解決了暫停/恢復 (Pause/Resume) 時的時間差問題**。

#### PiperChunks 的實作概念：
```javascript
async speak() {
    const text = this.next();
    
    // 1. 從 Engine 的 VoicePool 拿取聲音 (若還沒算好會 await 卡在這裡等)
    const audioBuffer = await this.engine.getVoiceFromPool(text);
    
    // 2. 將 Buffer 丟進 AudioContext 進行排程
    return new Promise(resolve => {
        const source = this.engine.playBuffer(audioBuffer);
        
        // 3. 乖乖等聲音確實播完
        source.onended = () => {
            resolve();
        };
    });
}
```

#### WebSpeechChunks 的實作概念：
```javascript
async speak() {
    const text = this.next();
    return new Promise(resolve => {
        const u = new SpeechSynthesisUtterance(text);
        u.onend = () => resolve(); // 乖乖等聲音確實播完
        window.speechSynthesis.speak(u);
    });
}
```

### 總結優勢
1. **架構極度乾淨**：`ZenTTS` 的播放代碼變成不到 10 行的 while 迴圈。暫停/播放邏輯無比強健。
2. **自然語氣**：利用 while 迴圈提取下一個 chunk 的微小時間差，自然形成標點符號的呼吸停頓。
3. **效能與記憶體最佳化**：Piper 可以透過 `VoicePool` 在背景預算。且藉由延遲清理（Lazy GC）機制，在同頁內隨意暫停、恢復或倒退重聽皆能享有極速的快取命中，只有在真正翻頁/跳頁時才在 `prepare()` 徹底清除舊快取，達成效能與記憶體使用的完美平衡。
