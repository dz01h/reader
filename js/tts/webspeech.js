class ZenTTSWebSpeech {
    constructor(app) {
        this.app = app;
        this._lastRawText = null;
        this.synth = window.speechSynthesis;
        
        // Ensure voices are loaded (some browsers load them asynchronously)
        if (this.synth.onvoiceschanged !== undefined) {
            this.synth.onvoiceschanged = () => this.synth.getVoices();
        }
    }

    _splitText(text) {
        if (!text) return [];
        return text.split(/[\n，。、；：！？－—…]+/)
            .map(s => s.replace(/\p{P}/gu, '').trim())
            .filter(s => s.length > 0);
    }

    prepare(readingData) {
        let text = readingData.reading;

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

        let currentChunks = this._splitText(text);
        
        // Web Speech doesn't need to prefetch next page chunks as it has no background worker pool
        return new ZenTTSWebSpeechChunks(this, currentChunks);
    }

    stopAudio(hardClear = true) {
        this.synth.cancel();
        if (hardClear) {
            this._lastRawText = null;
        }
    }

    suspendAudio() {
        this.synth.pause();
    }

    resumeAudio() {
        this.synth.resume();
    }

    destroy() {
        this.stopAudio(true);
    }
}

class ZenTTSWebSpeechChunks extends ZenTTSChunker {
    constructor(engine, chunks) {
        super('', null);
        this.engine = engine;
        this.chunks = chunks;
    }

    async speak() {
        const text = this.next();
        if (!text) return;

        // Notify controller to update MediaSession metadata
        document.body.dispatchEvent(new CustomEvent('ZenTTS:ChunkPlaying', { detail: { text } }));

        return new Promise(resolve => {
            const utterance = new SpeechSynthesisUtterance(text);
            
            // Set voice options based on user settings
            const voices = this.engine.synth.getVoices();
            if (this.engine.app.ttsVoice && voices.length > 0) {
                const selectedVoice = voices.find(v => v.voiceURI === this.engine.app.ttsVoice || v.name === this.engine.app.ttsVoice);
                if (selectedVoice) {
                    utterance.voice = selectedVoice;
                }
            }
            
            utterance.rate = this.engine.app.ttsSpeed || 1.0;
            
            utterance.onend = () => {
                // Add a natural pause between chunks (300ms)
                setTimeout(() => resolve(), 300); 
            };
            
            // Handle error gracefully so the playback loop doesn't get stuck
            utterance.onerror = (e) => {
                console.error("WebSpeech API Error:", e);
                resolve();
            };

            this.engine.synth.speak(utterance);
        });
    }
}

window.ZenTTSWebSpeech = ZenTTSWebSpeech;
