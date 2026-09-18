class Component extends HTMLElement {
    static FLAG_EVENT_POPUP = 1;
    static FLAG_EVENT_QUICK = 2;
    static FLAG_EVENT_SYNC  = 4;

    static isNativeEvent(eventType) {
        if (typeof eventType !== 'string') return false;
        const onType = 'on' + eventType.toLowerCase();
        return (
            (typeof window !== 'undefined' && onType in window) ||
            (typeof document !== 'undefined' && onType in document) ||
            (typeof HTMLElement !== 'undefined' && onType in HTMLElement.prototype)
        );
    }

    fireEvent(eventType, detail = {}, options = 0) {
        const bubbles = (options & Component.FLAG_EVENT_POPUP) > 0;
        let event;

        if (eventType instanceof Event) {
            event = eventType;
        } else if (Component.isNativeEvent(eventType)) {
            event = new Event(eventType, {
                bubbles: bubbles,
                cancelable: true
            });
            if (detail !== undefined && detail !== null) {
                event.detail = detail;
            }
        } else {
            event = new CustomEvent(eventType, {
                bubbles: bubbles,
                cancelable: true,
                detail: detail
            });
        }

        if (options & Component.FLAG_EVENT_SYNC) {
            this.dispatchEvent(event);
        } else if (options & Component.FLAG_EVENT_QUICK) {
            queueMicrotask(() => { this.dispatchEvent(event); });
        } else {
            setTimeout(() => { this.dispatchEvent(event); });
        }
    }
}

if (typeof window !== 'undefined') {
    window.Component = Component;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Component };
}