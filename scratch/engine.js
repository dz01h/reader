class ZenEngine {
    constructor(canvas, ctx) {
        this.canvas = canvas;
        this.ctx = ctx;
    }

    // Lays out the ENTIRE document efficiently for continuous scroll
    layoutDocument(text, fontSize, mode, lineHeightRatio = 1.8, fontFamily = 'sans-serif') {
        const cw = this.canvas.width / window.devicePixelRatio;
        const ch = this.canvas.height / window.devicePixelRatio;
        
        const lineHeight = fontSize * lineHeightRatio;
        const charSpacing = Math.max(1, fontSize * 0.05);

        // Padding
        const paddingX = Math.max(fontSize, 20); 
        const paddingY = Math.max(fontSize * 1.5, 30);

        let x = mode === 'vertical' ? cw - paddingX - fontSize : paddingX;
        let y = paddingY;
        
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
                    if (mode === 'vertical') {
                        x -= lineHeight; y = paddingY;
                    } else {
                        y += lineHeight; x = paddingX;
                    }
                }
                justAutoWrapped = false;
                i++; 
                while (i < text.length && (text[i] === ' ' || text[i] === '　' || text[i] === '\t')) i++;
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
                }
                drawOps.push({ char, x, y, isRotated, charIndex: i });
                y += verticalAdvance + charSpacing;
            } else {
                if (x + charW > cw - paddingX) {
                    y += lineHeight; 
                    x = paddingX;
                    justAutoWrapped = true;
                }
                drawOps.push({ char, x, y, isRotated: false, charIndex: i });
                x += charW + charSpacing;
            }
            i++;
        }
        
        // Final Bounds Calculation
        let maxScroll = 0;
        if (mode === 'vertical') {
            // Document grows negatively in X. Total width is how far negative X went.
            // Width needed = paddingX to start, and extends to (cw - (x - paddingX))
            // Maximum scroll offset (we scroll by modifying X offset towards POSITIVE)
            const docWidth = cw - x + paddingX;
            maxScroll = Math.max(0, docWidth - cw);
        } else {
            const docHeight = y + fontSize + paddingY;
            maxScroll = Math.max(0, docHeight - ch);
        }

        return { drawOps, maxScroll };
    }

    drawOperations(drawOps, scrollOffset, fontSize, mode, cw, ch, fontFamily = 'sans-serif') {
        const dpr = window.devicePixelRatio || 1;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Translate for continuous scrolling
        this.ctx.save();
        this.ctx.scale(dpr, dpr);
        
        if (mode === 'vertical') {
            this.ctx.translate(scrollOffset, 0); // Scroll right to reveal negative X
        } else {
            this.ctx.translate(0, -scrollOffset); // Scroll down to reveal positive Y
        }
        
        this.ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--color-text').trim() || '#ffffff';
        this.ctx.font = `${fontSize}px ${fontFamily}`;
        this.ctx.textBaseline = 'top';

        // Optimized culling bounds (what's visible on screen)
        const cullBuffer = fontSize * 2;
        let visibleMin, visibleMax;
        
        if (mode === 'vertical') {
            // screen represents [ -scrollOffset, cw - scrollOffset ]
            visibleMin = -scrollOffset - cullBuffer;
            visibleMax = cw - scrollOffset + cullBuffer;
        } else {
            // screen represents [ scrollOffset, ch + scrollOffset ]
            visibleMin = scrollOffset - cullBuffer;
            visibleMax = ch + scrollOffset + cullBuffer;
        }

        // Binary search to find start index (Optional, can just iterate for fast 1M chars but filtering visually is safer)
        for (let i = 0; i < drawOps.length; i++) {
            const op = drawOps[i];
            const coord = mode === 'vertical' ? op.x : op.y;
            
            // Check visibility
            if (coord > visibleMax) {
                if (mode === 'horizontal') break; // Early exit for horizontal since y is monotonically increasing!
            }
            if (coord < visibleMin) {
                if (mode === 'vertical') break; // Early exit for vertical since x is monotonically decreasing!
            }

            if (coord >= visibleMin && coord <= visibleMax) {
                if (op.isRotated) {
                    this.ctx.save();
                    this.ctx.translate(op.x + (fontSize / 2), op.y + (fontSize / 2));
                    this.ctx.rotate(Math.PI / 2);
                    this.ctx.fillText(op.char, -fontSize / 2, -fontSize / 2);
                    this.ctx.restore();
                } else {
                    this.ctx.fillText(op.char, op.x, op.y);
                }
            }
        }
        
        this.ctx.restore();
    }
}
window.ZenEngine = ZenEngine;
