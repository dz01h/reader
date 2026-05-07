class ZenEngine {
    constructor(canvas, ctx) {
        this.canvas = canvas;
        this.ctx = ctx;
    }

    // 將整個文件直接排版為長卷軸 (無縫卷軸)
    layoutDocument(text, fontSize, mode, cw, ch, lineHeightRatio = 1.8, fontFamily = 'sans-serif', margins = { top: 30, bottom: 30, left: 30, right: 30 }) {
        const lineHeight = fontSize * lineHeightRatio;
        const charSpacing = Math.max(1, fontSize * 0.05);

        let x = mode === 'vertical' ? cw - margins.right - fontSize : margins.left;
        let y = margins.top;
        
        const drawOps = [];
        let justAutoWrapped = false;

        this.ctx.font = `${fontSize}px ${fontFamily}`;

        let i = 0;
        while (i < text.length && (text[i] === ' ' || text[i] === '　' || text[i] === '\n' || text[i] === '\r')) {
            i++;
        }

        while (i < text.length) {
            const char = text[i];
            
            if (char === '\n') {
                if (!justAutoWrapped) {
                    const oldX = x;
                    const oldY = y;
                    if (mode === 'vertical') {
                        x -= lineHeight; y = margins.top;
                    } else {
                        y += lineHeight; x = margins.left;
                    }
                    // Add newline as a control op so TTS knows where original breaks are
                    drawOps.push({ char: '\n', x: oldX, y: oldY, isControl: true, charIndex: i });
                }
                justAutoWrapped = false;
                i++; 
                while (i < text.length && (text[i] === ' ' || text[i] === '　' || text[i] === '\t')) i++;
                continue;
            }
            if (char === '\r') { i++; continue; }
            
            justAutoWrapped = false;

            const isAscii = char.charCodeAt(0) < 256;
            let asciiSeqLen = 0;
            if (isAscii && mode === 'vertical') {
                // Peek ahead and back to find total length of ASCII sequence
                let start = i;
                while (start > 0 && text[start-1].charCodeAt(0) < 256 && text[start-1] !== '\n') start--;
                let end = i;
                while (end < text.length && text[end].charCodeAt(0) < 256 && text[end] !== '\n') end++;
                asciiSeqLen = end - start;
            }

            const charW = isAscii ? this.ctx.measureText(char).width : fontSize;
            // Only rotate if it's a sequence of 3 or more ASCII chars
            const shouldRotateAscii = isAscii && asciiSeqLen >= 3;
            const isRotated = mode === 'vertical' && (shouldRotateAscii || /^[「」『』（）〈〉《》—…~＿｜\-]$/.test(char));

            if (mode === 'vertical') {
                const verticalAdvance = isRotated && isAscii ? charW : fontSize;
                // Add 1px buffer to prevent sub-pixel cutting at the bottom
                if (y + verticalAdvance > ch - margins.bottom - 1) {
                    x -= lineHeight; 
                    y = margins.top;
                    justAutoWrapped = true;
                }
                drawOps.push({ char, x, y, isRotated, charIndex: i });
                y += verticalAdvance + charSpacing;
            } else {
                // Add 1px buffer to prevent sub-pixel cutting at the right edge
                if (x + charW > cw - margins.right - 1) {
                    y += lineHeight; 
                    x = margins.left;
                    justAutoWrapped = true;
                }
                drawOps.push({ char, x, y, isRotated, charIndex: i });
                x += charW + charSpacing;
            }
            i++;
        }
        
        let maxScroll = 0;
        if (mode === 'vertical') {
            const docWidth = cw - x + margins.left;
            maxScroll = Math.max(0, docWidth - cw);
        } else {
            const docHeight = y + fontSize + margins.bottom;
            maxScroll = Math.max(0, docHeight - ch);
        }

        return { drawOps, maxScroll };
    }

    drawOperations(drawOps, scrollOffset, fontSize, mode, cw, ch, fontFamily = 'sans-serif') {
        const dpr = Math.max(window.devicePixelRatio || 1, 2); // Match app.js strict retina policy
        
        // Reset transform to identity matrix to guarantee full clear Rect works
        this.ctx.setTransform(1, 0, 0, 1, 0, 0); 
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        this.ctx.scale(dpr, dpr);
        this.ctx.save();
        
        if (mode === 'vertical') {
            this.ctx.translate(scrollOffset, 0);
        } else {
            this.ctx.translate(0, -scrollOffset);
        }
        
        this.ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--color-text').trim() || '#ffffff';
        this.ctx.font = `${fontSize}px ${fontFamily}`;
        this.ctx.textBaseline = 'top';

        const cullBuffer = fontSize * 2;
        let visibleMin, visibleMax;
        
        if (mode === 'vertical') {
            visibleMin = -scrollOffset - cullBuffer;
            visibleMax = cw - scrollOffset + cullBuffer;
        } else {
            visibleMin = scrollOffset - cullBuffer;
            visibleMax = ch + scrollOffset + cullBuffer;
        }

        for (let i = 0; i < drawOps.length; i++) {
            const op = drawOps[i];
            
            if (op.isControl) continue; // Skip newlines and other control characters
            
            const coord = mode === 'vertical' ? op.x : op.y;
            
            // Fast culling
            if (coord > visibleMax) {
                if (mode === 'horizontal') break; 
            }
            if (coord < visibleMin) {
                if (mode === 'vertical') break; 
            }

            if (coord >= visibleMin && coord <= visibleMax) {
                if (op.isRotated) {
                    this.ctx.save();
                    this.ctx.translate(op.x + (fontSize / 2), op.y + (fontSize / 2));
                    this.ctx.rotate(Math.PI / 2);
                    this.ctx.fillText(op.char, -fontSize / 2, -fontSize / 2);
                    this.ctx.restore();
                } else {
                    let drawX = op.x;
                    // Center narrow ASCII characters in vertical columns
                    if (mode === 'vertical' && op.char.charCodeAt(0) < 256) {
                        const w = this.ctx.measureText(op.char).width;
                        drawX += (fontSize - w) / 2;
                    }
                    this.ctx.fillText(op.char, drawX, op.y);
                }
            }
        }
        
        this.ctx.restore();
    }
}
window.ZenEngine = ZenEngine;
