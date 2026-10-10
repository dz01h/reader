/**
 * js/tts.js — ZenTTS Compatibility Layer
 * TTS controller and UI is now mounted as the custom element <nav-tts-button> (NavTtsButton).
 */
class ZenTTS {
    constructor(app) {
        this.app = app;
        const btn = document.querySelector('nav-tts-button') || document.getElementById('btn-tts-toggle');
        if (btn) return btn;
    }
}

if (typeof window !== 'undefined') {
    window.ZenTTS = window.NavTtsButton || ZenTTS;
}
