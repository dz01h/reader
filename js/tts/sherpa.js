/**
 * sherpa.js — ZenTTSSherpa
 * sherpa-onnx WASM 為基底的 TTS 引擎，實作 TTS_SPEC.md 抽象介面。
 *
 * 支援動態抽換模型（VITS、Matcha 等），模型檔案首次使用時從 HuggingFace 下載
 * 並透過 Service Worker Cache API 快取，之後離線可用。
 */

// ─────────────────────────────────────────────
// 預設可用模型清單（供 settings.js 使用）
// ─────────────────────────────────────────────
// voiceId 格式：'sherpa:<modelKey>:<sid>'
// modelKey 對應下方 SHERPA_MODELS 的 key

window.SHERPA_MODELS = {
    /**
     * vits-zh-hf-eula — 804 說話人，中文，22050Hz，117MB
     * HuggingFace: csukuangfj/vits-zh-hf-eula
     */
    'vits-zh-hf-eula': {
        name: 'EULA (中文 804 說話人)',
        sampleRate: 22050,
        modelUrl: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-zh-hf-eula.tar.bz2',
        // 解壓後的個別檔案 URL（使用 HuggingFace LFS 直鏈）
        files: {
            model:   'https://huggingface.co/csukuangfj/vits-zh-hf-eula/resolve/main/eula.onnx',
            tokens:  'https://huggingface.co/csukuangfj/vits-zh-hf-eula/resolve/main/tokens.txt',
            lexicon: 'https://huggingface.co/csukuangfj/vits-zh-hf-eula/resolve/main/lexicon.txt',
            ruleFsts: [
                'https://huggingface.co/csukuangfj/vits-zh-hf-eula/resolve/main/phone.fst',
                'https://huggingface.co/csukuangfj/vits-zh-hf-eula/resolve/main/date.fst',
                'https://huggingface.co/csukuangfj/vits-zh-hf-eula/resolve/main/number.fst'
            ],
            dictDir: [
                'https://huggingface.co/csukuangfj/vits-zh-hf-eula/resolve/main/dict/jieba.dict.utf8',
                'https://huggingface.co/csukuangfj/vits-zh-hf-eula/resolve/main/dict/hmm_model.utf8',
                'https://huggingface.co/csukuangfj/vits-zh-hf-eula/resolve/main/dict/idf.utf8',
                'https://huggingface.co/csukuangfj/vits-zh-hf-eula/resolve/main/dict/stop_words.utf8',
                'https://huggingface.co/csukuangfj/vits-zh-hf-eula/resolve/main/dict/user.dict.utf8'
            ]
        },
        speakers: {
            0:   '說話人 0（女）',
            99:  '說話人 99（女）',
            188: '說話人 188（男）',
        },
    },
    /**
     * sherpa-onnx-vits-zh-ll — 中文，不需要 Jieba 字典
     */
    'vits-zh-ll': {
        name: 'LL 輕量中文 (無字典)',
        sampleRate: 22050,
        files: {
            model:   'https://huggingface.co/csukuangfj/sherpa-onnx-vits-zh-ll/resolve/main/model.onnx',
            tokens:  'https://huggingface.co/csukuangfj/sherpa-onnx-vits-zh-ll/resolve/main/tokens.txt',
            lexicon: 'https://huggingface.co/csukuangfj/sherpa-onnx-vits-zh-ll/resolve/main/lexicon.txt',
            ruleFsts: [
                'https://huggingface.co/csukuangfj/sherpa-onnx-vits-zh-ll/resolve/main/phone.fst',
                'https://huggingface.co/csukuangfj/sherpa-onnx-vits-zh-ll/resolve/main/date.fst',
                'https://huggingface.co/csukuangfj/sherpa-onnx-vits-zh-ll/resolve/main/number.fst',
                'https://huggingface.co/csukuangfj/sherpa-onnx-vits-zh-ll/resolve/main/new_heteronym.fst'
            ]
        },
        speakers: {
            0: '說話人 0',
        },
    },
    /**
     * vits-melo-tts-zh_en — 中英雙語，1 說話人，44100Hz，163MB
     * 支援中英文混讀（lexicon 只涵蓋已知英文詞彙）
     */
    'vits-melo-tts-zh_en': {
        name: 'MeloTTS 中英雙語',
        sampleRate: 44100,
        files: {
            model:   'https://huggingface.co/csukuangfj/vits-melo-tts-zh_en/resolve/main/model.onnx',
            tokens:  'https://huggingface.co/csukuangfj/vits-melo-tts-zh_en/resolve/main/tokens.txt',
            lexicon: 'https://huggingface.co/csukuangfj/vits-melo-tts-zh_en/resolve/main/lexicon.txt',
            ruleFsts: [
                'https://huggingface.co/csukuangfj/vits-melo-tts-zh_en/resolve/main/phone.fst',
                'https://huggingface.co/csukuangfj/vits-melo-tts-zh_en/resolve/main/date.fst',
                'https://huggingface.co/csukuangfj/vits-melo-tts-zh_en/resolve/main/number.fst'
            ],
            dictDir: [
                'https://huggingface.co/csukuangfj/vits-melo-tts-zh_en/resolve/main/dict/jieba.dict.utf8',
                'https://huggingface.co/csukuangfj/vits-melo-tts-zh_en/resolve/main/dict/hmm_model.utf8',
                'https://huggingface.co/csukuangfj/vits-melo-tts-zh_en/resolve/main/dict/idf.utf8',
                'https://huggingface.co/csukuangfj/vits-melo-tts-zh_en/resolve/main/dict/stop_words.utf8',
                'https://huggingface.co/csukuangfj/vits-melo-tts-zh_en/resolve/main/dict/user.dict.utf8'
            ]
        },
        speakers: {
            0: '中英混讀（單說話人）',
        },
    },
    'matcha-icefall-zh-baker': {
        name: 'Matcha Baker (高音質女聲)',
        engine: 'matcha',
        sampleRate: 22050,
        files: {
            acousticModel: 'https://huggingface.co/csukuangfj/matcha-icefall-zh-baker/resolve/main/model-steps-3.onnx',
            vocoder: 'https://huggingface.co/csukuangfj/sherpa-onnx-hifigan/resolve/main/hifigan_v2.onnx',
            tokens: 'https://huggingface.co/csukuangfj/matcha-icefall-zh-baker/resolve/main/tokens.txt',
            lexicon: 'https://huggingface.co/csukuangfj/matcha-icefall-zh-baker/resolve/main/lexicon.txt',
            ruleFsts: [
                'https://huggingface.co/csukuangfj/matcha-icefall-zh-baker/resolve/main/date.fst',
                'https://huggingface.co/csukuangfj/matcha-icefall-zh-baker/resolve/main/number.fst',
                'https://huggingface.co/csukuangfj/matcha-icefall-zh-baker/resolve/main/phone.fst'
            ]
        },
        speakers: {
            0: 'Baker 女聲',
        },
    },
    'vits-zh-hf-fanchen-c': {
        name: 'VITS FanChen-C (清亮女聲)',
        engine: 'vits',
        sampleRate: 22050,
        files: {
            model: 'https://huggingface.co/csukuangfj/vits-zh-hf-fanchen-c/resolve/main/vits-zh-hf-fanchen-C.onnx',
            tokens: 'https://huggingface.co/csukuangfj/vits-zh-hf-fanchen-c/resolve/main/tokens.txt',
            lexicon: 'https://huggingface.co/csukuangfj/vits-zh-hf-fanchen-c/resolve/main/lexicon.txt',
            ruleFsts: [
                'https://huggingface.co/csukuangfj/vits-zh-hf-fanchen-c/resolve/main/date.fst',
                'https://huggingface.co/csukuangfj/vits-zh-hf-fanchen-c/resolve/main/number.fst',
                'https://huggingface.co/csukuangfj/vits-zh-hf-fanchen-c/resolve/main/phone.fst',
                'https://huggingface.co/csukuangfj/vits-zh-hf-fanchen-c/resolve/main/new_heteronym.fst'
            ]
        },
        speakers: {
            0: 'FanChen-C 女聲',
        },
    },
    'matcha-icefall-zh-en': {
        name: 'Matcha 中英雙語 (高速)',
        engine: 'matcha',
        sampleRate: 16000,
        files: {
            model: 'https://huggingface.co/csukuangfj/matcha-icefall-zh-en/resolve/main/model-steps-3.onnx',
            vocoder: 'https://modelscope.cn/models/dengcunqin/matcha_tts_zh_en_20251010/resolve/master/vocos-16khz-univ.onnx',
            tokens: 'https://huggingface.co/csukuangfj/matcha-icefall-zh-en/resolve/main/tokens.txt',
            lexicon: 'https://huggingface.co/csukuangfj/matcha-icefall-zh-en/resolve/main/lexicon.txt',
            ruleFsts: [
                'https://huggingface.co/csukuangfj/matcha-icefall-zh-en/resolve/main/date-zh.fst',
                'https://huggingface.co/csukuangfj/matcha-icefall-zh-en/resolve/main/number-zh.fst',
                'https://huggingface.co/csukuangfj/matcha-icefall-zh-en/resolve/main/phone-zh.fst'
            ],
            dataFiles: [
                'https://huggingface.co/csukuangfj/matcha-icefall-zh-en/resolve/main/espeak-ng-data/phontab',
                'https://huggingface.co/csukuangfj/matcha-icefall-zh-en/resolve/main/espeak-ng-data/phonindex',
                'https://huggingface.co/csukuangfj/matcha-icefall-zh-en/resolve/main/espeak-ng-data/phondata',
                'https://huggingface.co/csukuangfj/matcha-icefall-zh-en/resolve/main/espeak-ng-data/intonations',
                'https://huggingface.co/csukuangfj/matcha-icefall-zh-en/resolve/main/espeak-ng-data/en_dict',
                'https://huggingface.co/csukuangfj/matcha-icefall-zh-en/resolve/main/espeak-ng-data/cmn_dict'
            ]
        },
        speakers: {
            0: '預設說話人',
        },
    },
    'kokoro-multi-lang-v1_1': {
        name: 'Kokoro v1.1 (多語系/女聲為主)',
        engine: 'kokoro',
        sampleRate: 24000,
        files: {
            model: 'https://huggingface.co/csukuangfj/kokoro-multi-lang-v1_1/resolve/main/model.onnx',
            tokens: 'https://huggingface.co/csukuangfj/kokoro-multi-lang-v1_1/resolve/main/tokens.txt',
            voices: 'https://huggingface.co/csukuangfj/kokoro-multi-lang-v1_1/resolve/main/voices.bin',
            lexicon: 'https://huggingface.co/csukuangfj/kokoro-multi-lang-v1_1/resolve/main/lexicon-zh.txt,https://huggingface.co/csukuangfj/kokoro-multi-lang-v1_1/resolve/main/lexicon-us-en.txt',
            ruleFsts: [
                'https://huggingface.co/csukuangfj/kokoro-multi-lang-v1_1/resolve/main/date-zh.fst',
                'https://huggingface.co/csukuangfj/kokoro-multi-lang-v1_1/resolve/main/number-zh.fst',
                'https://huggingface.co/csukuangfj/kokoro-multi-lang-v1_1/resolve/main/phone-zh.fst'
            ],
            dataFiles: [
                'https://huggingface.co/csukuangfj/kokoro-multi-lang-v1_1/resolve/main/espeak-ng-data/phontab',
                'https://huggingface.co/csukuangfj/kokoro-multi-lang-v1_1/resolve/main/espeak-ng-data/phonindex',
                'https://huggingface.co/csukuangfj/kokoro-multi-lang-v1_1/resolve/main/espeak-ng-data/phondata',
                'https://huggingface.co/csukuangfj/kokoro-multi-lang-v1_1/resolve/main/espeak-ng-data/intonations',
                'https://huggingface.co/csukuangfj/kokoro-multi-lang-v1_1/resolve/main/espeak-ng-data/en_dict',
                'https://huggingface.co/csukuangfj/kokoro-multi-lang-v1_1/resolve/main/espeak-ng-data/cmn_dict'
            ]
        },
        speakers: {
            0: 'Kokoro 中文 (Speaker 0)',
            36: 'Kokoro 中文 (Speaker 36)',
        },
    },
};

// ─────────────────────────────────────────────
// 引擎主類別
// ─────────────────────────────────────────────

class ZenTTSSherpa {
    constructor(app) {
        this.app = app;
        this.pool = null;
        this.voicePool = new Map(); // text → { status, buffer, promise, resolve }

        this.audioCtx = null;
        this.compressor = null;
        this.nextStartTime = 0;
        this._scheduledSources = [];
        this._lastRawText = null;
        this.isManualSuspended = false;

        this._workerReady = false;
        this._workerReadyPromise = null;
        this._workerReadyResolve = null;
        this._currentModelKey = null;

        this._setupAudioContext();
        this._createWorker();
    }

    // ── Audio Context ──────────────────────────

    _setupAudioContext() {
        if (!this.audioCtx) {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            this.compressor = this.audioCtx.createDynamicsCompressor();
            this.compressor.threshold.setValueAtTime(-1.0, this.audioCtx.currentTime);
            this.compressor.knee.setValueAtTime(40, this.audioCtx.currentTime);
            this.compressor.ratio.setValueAtTime(12, this.audioCtx.currentTime);
            this.compressor.attack.setValueAtTime(0, this.audioCtx.currentTime);
            this.compressor.release.setValueAtTime(0.25, this.audioCtx.currentTime);
            this.compressor.connect(this.audioCtx.destination);
        }
    }

    // ── Worker 管理 ────────────────────────────

    _parseVoiceId(voiceId) {
        // voiceId 格式可能是 'vits-zh-hf-eula:0' 或 'sherpa:vits-zh-hf-eula:0'
        let parts = (voiceId || 'vits-zh-hf-eula:0').split(':');
        if (parts[0] === 'sherpa') {
            parts.shift(); // 移除 'sherpa' prefix
        }
        const modelKey = parts[0] || 'vits-zh-hf-eula';
        const sid = parseInt(parts[1] || '0', 10);
        return { modelKey, sid };
    }

    _createWorker() {
        this._workerReady = false;
        this._workerReadyPromise = new Promise(r => this._workerReadyResolve = r);

        if (this.pool) {
            this.pool.clear(true);
        }

        this.pool = new SherpaWorkerPool(2, this);
    }

    async _ensureModelLoaded(modelKey) {
        if (this._workerReady && this._currentModelKey === modelKey) return;

        // 切換模型時需重建 Worker
        if (this._currentModelKey !== null && this._currentModelKey !== modelKey) {
            this._createWorker();
        }

        this._currentModelKey = modelKey;
        const modelDef = window.SHERPA_MODELS[modelKey];
        if (!modelDef) throw new Error(`未知模型: ${modelKey}`);

        const modelConfig = {
            engine: modelDef.engine || 'vits',
            files: modelDef.files,
        };

        this.pool.initWorkers(modelConfig);

        await this._workerReadyPromise;
    }

    // (移至 SherpaWorkerPool 內部處理，因此刪除 ZenTTSSherpa 的 _onWorkerMsg 與 _dispatch 實作)
    
    _dispatch() {
        if (!this._workerReady) return;
        this.pool.dispatch();
    }

    // ── TTS_SPEC 介面 ─────────────────────────

    _splitText(text) {
        if (!text) return [];
        return text.split(/[\n，。、；：！？－—…]+/)
            .map(s => s.replace(/\p{P}/gu, '').trim())
            .filter(s => s.length > 0);
    }

    prepare(readingData) {
        let text = readingData.reading;

        // 跨頁重疊去除
        if (this._lastRawText && text && this._lastRawText !== text) {
            const maxOverlap = Math.min(this._lastRawText.length, text.length);
            for (let i = maxOverlap; i > 0; i--) {
                if (this._lastRawText.endsWith(text.substring(0, i))) {
                    text = text.substring(i);
                    break;
                }
            }
        }
        this._lastRawText = readingData.reading;

        const currentChunks = this._splitText(text);
        const nextChunks = this._splitText(readingData.nextReading);
        const allNeededKeys = new Set([...currentChunks, ...nextChunks]);

        // GC + 新增 pending 項目
        const newVoicePool = new Map();
        for (const key of allNeededKeys) {
            if (this.voicePool.has(key)) {
                newVoicePool.set(key, this.voicePool.get(key));
            } else {
                let resolveFunc = null;
                const promise = new Promise(r => resolveFunc = r);
                newVoicePool.set(key, { status: 'pending', buffer: null, promise, resolve: resolveFunc });
            }
        }
        this.voicePool = newVoicePool;

        // 確保模型已載入，然後開始調度
        const voiceId = this.app.ttsVoice || 'vits-zh-hf-eula:0';
        const { modelKey } = this._parseVoiceId(voiceId);

        // 非同步初始化，不等待（Worker 準備好後自動 dispatch）
        this._ensureModelLoaded(modelKey).catch(err => {
            console.error('[ZenTTSSherpa] 模型載入失敗:', err);
        });

        if (this._workerReady) {
            this._dispatch();
        }

        return new ZenTTSSherpaChunks(this, currentChunks);
    }

    async getVoiceFromPool(text) {
        const item = this.voicePool.get(text);
        if (!item) return null;
        if (item.status === 'done') return item.buffer;
        await item.promise;
        return item.buffer;
    }

    playBuffer(audioBuffer) {
        if (this.audioCtx.state === 'suspended' && !this.isManualSuspended) {
            this.audioCtx.resume();
        }

        const source = this.audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.playbackRate.value = 1.0; // sherpa-onnx 合成時已套用 speed，不需在此再調

        const gainNode = this.audioCtx.createGain();
        source.connect(gainNode);
        gainNode.connect(this.compressor);

        const now = this.audioCtx.currentTime;
        const start = Math.max(now, this.nextStartTime);
        const duration = audioBuffer.duration;

        const fadeTime = 0.005;
        gainNode.gain.setValueAtTime(0, start);
        gainNode.gain.linearRampToValueAtTime(1, start + fadeTime);
        gainNode.gain.setValueAtTime(1, start + duration - fadeTime);
        gainNode.gain.linearRampToValueAtTime(0, start + duration);

        source.start(start);
        this.nextStartTime = start + duration;
        this._scheduledSources.push(source);

        source.onended = () => {
            this._scheduledSources = this._scheduledSources.filter(s => s !== source);
        };

        return source;
    }

    suspendAudio() {
        this.isManualSuspended = true;
        if (this.audioCtx && this.audioCtx.state === 'running') {
            this.audioCtx.suspend();
        }
    }

    resumeAudio() {
        this.isManualSuspended = false;
        if (this.audioCtx && this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }
    }

    stopAudio(hardClear = true) {
        this._scheduledSources.forEach(s => {
            try { s.stop(); } catch (e) {}
            s.disconnect();
        });
        this._scheduledSources = [];
        this.nextStartTime = 0;
        this.suspendAudio();

        if (hardClear) {
            // voicePool 的 pending 項目全部標記失敗，讓等待中的 speak() 不卡住
            for (const [, item] of this.voicePool.entries()) {
                if (item.status === 'pending' || item.status === 'computing') {
                    item.status = 'done';
                    item.buffer = null;
                    if (item.resolve) item.resolve(null);
                }
            }
            this.voicePool.clear();
            this._lastRawText = null;
        }
    }

    destroy() {
        this.stopAudio(true);
        if (this.pool) {
            this.pool.clear(true);
            this.pool = null;
        }
        if (this.audioCtx) {
            try { this.audioCtx.close(); } catch (e) {}
            this.audioCtx = null;
        }
        this._workerReady = false;
    }
}

// ─────────────────────────────────────────────
// Chunks 類別
// ─────────────────────────────────────────────

class ZenTTSSherpaChunks extends ZenTTSChunker {
    constructor(engine, chunks) {
        super('', null);
        this.engine = engine;
        this.chunks = chunks;
    }

    async speak() {
        const text = this.next();
        if (!text) return;

        const audioBuffer = await this.engine.getVoiceFromPool(text);
        if (!audioBuffer) return;

        document.body.dispatchEvent(new CustomEvent('ZenTTS:ChunkPlaying', { detail: { text } }));

        return new Promise(resolve => {
            const source = this.engine.playBuffer(audioBuffer);
            const originalOnEnded = source.onended;
            source.onended = (e) => {
                if (originalOnEnded) originalOnEnded(e);
                setTimeout(() => resolve(), 300);
            };
        });
    }
}

// ─────────────────────────────────────────────
// Worker Pool
// ─────────────────────────────────────────────

class SherpaWorkerPool {
    constructor(size = 2, engine) {
        this.size = size;
        this.engine = engine;
        this.workers = [];
        this._sessionId = 0;
        this.readyCount = 0;

        for (let i = 0; i < size; i++) {
            this._createWorker();
        }
    }

    _createWorker() {
        const w = new Worker('js/tts/sherpa-worker.js');
        w._busy = false;
        w.onmessage = (e) => this._onWorkerMsg(w, e.data);
        w.onerror = (err) => console.error('[ZenTTSSherpa] Worker error:', err);
        this.workers.push(w);
    }

    initWorkers(modelConfig) {
        this.readyCount = 0;
        this.modelConfig = modelConfig;
        for (const w of this.workers) {
            w.postMessage({ type: 'INIT', modelConfig });
        }
    }

    dispatch() {
        const pendingKeys = [];
        for (const [key, item] of this.engine.voicePool.entries()) {
            if (item.status === 'pending') {
                pendingKeys.push(key);
            }
        }

        for (const w of this.workers) {
            if (!w._busy && pendingKeys.length > 0) {
                const key = pendingKeys.shift();
                const item = this.engine.voicePool.get(key);
                if (item) item.status = 'computing';
                
                w._busy = true;
                const voiceId = this.engine.app.ttsVoice || 'vits-zh-hf-eula:0';
                const { modelKey, sid } = this.engine._parseVoiceId(voiceId);
                const speed = this.engine.app.ttsSpeed || 1.0;

                w.postMessage({ type: 'SYNTHESIZE', text: key, sid, speed, sessionId: this._sessionId });
            }
        }
    }

    _onWorkerMsg(worker, data) {
        if (data.type === 'READY') {
            this.readyCount++;
            if (this.readyCount === this.size) {
                this.engine._workerReady = true;
                document.body.dispatchEvent(new CustomEvent('ZenTTS:Status', { detail: { status: 'ready' } }));
                if (this.engine._workerReadyResolve) this.engine._workerReadyResolve();
                this.dispatch();
            }
            return;
        }

        if (data.type === 'INIT_PROGRESS') {
            // 避免多個 worker 重複發送載入中事件洗版，只處理第一個 worker 的訊息
            if (worker === this.workers[0]) {
                document.body.dispatchEvent(new CustomEvent('ZenTTS:Status', { detail: { status: 'loading', message: data.message } }));
            }
            return;
        }

        worker._busy = false;

        if (data.type === 'DONE') {
            const item = this.engine.voicePool.get(data.text);
            if (item) {
                this.engine._setupAudioContext();
                const sampleRate = data.sampleRate || 22050;
                try {
                    const audioBuffer = this.engine.audioCtx.createBuffer(1, data.samples.length, sampleRate);
                    audioBuffer.copyToChannel(data.samples, 0);
                    const currentItem = this.engine.voicePool.get(data.text);
                    if (currentItem) {
                        currentItem.status = 'done';
                        currentItem.buffer = audioBuffer;
                        if (currentItem.resolve) currentItem.resolve(audioBuffer);
                    }
                } catch (err) {
                    console.error('[ZenTTSSherpa] createBuffer error:', err);
                    const currentItem = this.engine.voicePool.get(data.text);
                    if (currentItem) {
                        currentItem.status = 'done';
                        currentItem.buffer = null;
                        if (currentItem.resolve) currentItem.resolve(null);
                    }
                }
            }
        } else if (data.type === 'ERROR') {
            console.error('[ZenTTSSherpa] Worker ERROR:', data.error, 'text:', data.text);
            if (worker === this.workers[0]) {
                document.body.dispatchEvent(new CustomEvent('ZenTTS:Status', { detail: { status: 'error', message: data.error } }));
            }
            const item = this.engine.voicePool.get(data.text);
            if (item) {
                item.status = 'done';
                item.buffer = null;
                if (item.resolve) item.resolve(null);
            }
        }

        this.dispatch();
    }

    clear(hard = false) {
        if (hard) {
            this.workers.forEach(w => {
                try { w.terminate(); } catch(e) {}
            });
            this.workers = [];
            for (let i = 0; i < this.size; i++) {
                this._createWorker();
            }
            if (this.modelConfig) {
                this.initWorkers(this.modelConfig);
            }
        }
    }
}

window.ZenTTSSherpa = ZenTTSSherpa;
