export class Action {
    constructor() {
        this._boundHandlers = new Map();
        this.mountEvents();
    }

    getEventName(methodName) {
        const rawName = methodName.slice(2);
        if (!rawName) return null;

        // 若為標準 DOM 事件 (如 onClick -> click, onPointerDown -> pointerdown)
        const lowerName = rawName.toLowerCase();
        if (`on${lowerName}` in window || `on${lowerName}` in document || `on${lowerName}` in (document.body || {})) {
            return lowerName;
        }

        // 否則保留自定義事件名稱 (如 onReadingOperation -> ReadingOperation)
        return rawName;
    }

    mountEvents() {
        let proto = this;
        const processedMethods = new Set();
        const target = document.body || document;

        while (proto && proto !== Object.prototype) {
            const props = Object.getOwnPropertyNames(proto);
            for (const prop of props) {
                if (prop.startsWith('on') && typeof this[prop] === 'function' && !processedMethods.has(prop)) {
                    processedMethods.add(prop);
                    const eventName = this.getEventName(prop);
                    if (eventName) {
                        const handler = this[prop].bind(this);
                        this._boundHandlers.set(prop, { eventName, handler });
                        target.addEventListener(eventName, handler);
                    }
                }
            }
            proto = Object.getPrototypeOf(proto);
        }
    }

    unmountEvents() {
        if (!this._boundHandlers) return;
        const target = document.body || document;
        for (const [prop, { eventName, handler }] of this._boundHandlers.entries()) {
            target.removeEventListener(eventName, handler);
        }
        this._boundHandlers.clear();
    }
}