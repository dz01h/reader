class ZenEngine {
    constructor(canvas, ctx) {
        this.canvas = canvas;
        this.ctx = ctx;
    }

    layoutPage(text, startIndex, fontSize, mode, lineHeightRatio = 1.8, fontFamily = 'sans-serif') {
        const rect = this.canvas.getBoundingClientRect();
        const cw = rect.width;
        const ch = rect.height;
        
        const lineHeight = fontSize * lineHeightRatio;
        const charSpacing = Math.max(1, fontSize * 0.05);

        // Add a safety margin so text avoids hitting absolute screen edges where ascenders get clipped
        const paddingX = Math.max(fontSize, 20); 
        const paddingY = Math.max(fontSize * 1.5, 30);

        let x = mode === 'vertical' ? cw - paddingX - fontSize : paddingX;
        let y = paddingY;
        
        let i = startIndex;
        const drawOps = [];
        let justAutoWrapped = false;

        this.ctx.font = `${fontSize}px ${fontFamily}`;

        // At the very beginning of the document, completely skip any leading blank lines or spaces
        if (i === 0) {
            while (i < text.length && (text[i] === ' ' || text[i] === '　' || text[i] === '\n' || text[i] === '\r')) {
                i++;
            }
        }

        while (i < text.length) {
            const char = text[i];
            
            if (char === '\n') {
                if (justAutoWrapped) {
                    // Ignore this \n because the layout engine ALREADY pushed us to a new line exactly one char ago
                    justAutoWrapped = false;
                } else {
                    if (mode === 'vertical') {
                        x -= lineHeight; y = paddingY;
                        if (x < paddingX) { i++; break; }
                    } else {
                        y += lineHeight; x = paddingX;
                        if (y + lineHeight > ch - paddingY) { i++; break; }
                    }
                }
                
                i++; 
                
                // User requested: skip spaces immediately following a newline to unify paragraph formatting
                while (i < text.length && (text[i] === ' ' || text[i] === '　' || text[i] === '\t')) {
                    i++;
                }
                continue;
            }
            if (char === '\r') { i++; continue; }
            
            justAutoWrapped = false;

            const isAscii = char.charCodeAt(0) < 256;
            const charW = isAscii ? this.ctx.measureText(char).width : fontSize;
            const isRotated = mode === 'vertical' && (isAscii || /^[「」『』（）〈〉《》—…~＿｜\-]$/.test(char));

            if (mode === 'vertical') {
                const verticalAdvance = isRotated && isAscii ? charW : fontSize;
                
                if (y + verticalAdvance > ch - paddingY) {
                    x -= lineHeight; 
                    y = paddingY;
                    justAutoWrapped = true;
                    if (x < paddingX) break;
                }
                drawOps.push({ char, x, y, isRotated });
                y += verticalAdvance + charSpacing;
            } else {
                if (x + charW > cw - paddingX) {
                    y += lineHeight; 
                    x = paddingX;
                    justAutoWrapped = true;
                    if (y + lineHeight > ch - paddingY) break;
                }
                drawOps.push({ char, x, y, isRotated: false });
                x += charW + charSpacing;
            }
            i++;
        }
        return { nextIndex: i, drawOps };
    }

    drawOperations(drawOps, fontSize, mode, fontFamily = 'sans-serif') {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--color-text').trim() || '#ffffff';
        
        this.ctx.font = `${fontSize}px ${fontFamily}`;
        this.ctx.textBaseline = 'top';

        for (const op of drawOps) {
            const { char, x, y, isRotated } = op;
            if (isRotated) {
                this.ctx.save();
                this.ctx.translate(x + fontSize, y);
                this.ctx.rotate(Math.PI / 2);
                this.ctx.fillText(char, 0, 0);
                this.ctx.restore();
            } else {
                this.ctx.fillText(char, x, y);
            }
        }
    }
}

window.ZenEngine = ZenEngine;
