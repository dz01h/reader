class ZenEngine {
    constructor(canvas, ctx) {
        this.canvas = canvas;
        this.ctx = ctx;
    }

    // 將整個文件直接排版為長卷軸 (無縫卷軸)
    layoutDocument(text, fontSize, mode, cw, ch, lineHeightRatio = 1.8, fontFamily = 'sans-serif', margins = { top: 30, bottom: 30, left: 30, right: 30 }) {
        const lineHeight = fontSize * lineHeightRatio;
        const charSpacing = Math.max(1, fontSize * 0.05);

        const padX = Math.max(4, fontSize * 0.1);
        const padY = Math.max(4, fontSize * 0.1);

        let startX, startY;
        if (mode === 'vertical') {
            const availableWidth = cw - margins.left - margins.right - padX * 2;
            let N = 1;
            if (availableWidth >= fontSize) {
                N = Math.floor((availableWidth - fontSize) / lineHeight) + 1;
            }
            const usedWidth = (N - 1) * lineHeight + fontSize;
            const leftover = Math.max(0, availableWidth - usedWidth);
            
            startX = cw - margins.right - padX - leftover / 2 - fontSize;
            startY = margins.top + padY;
        } else {
            const availableHeight = ch - margins.top - margins.bottom - padY * 2;
            let N = 1;
            if (availableHeight >= fontSize) {
                N = Math.floor((availableHeight - fontSize) / lineHeight) + 1;
            }
            const usedHeight = (N - 1) * lineHeight + fontSize;
            const leftover = Math.max(0, availableHeight - usedHeight);
            
            startX = margins.left + padX;
            startY = margins.top + padY + leftover / 2;
        }

        let x = startX;
        let y = startY;
        
        const drawOps = [];
        let justAutoWrapped = false;

        this.ctx.font = `${fontSize}px ${fontFamily}`;

        let i = 0;
        while (i < text.length && (text[i] === ' ' || text[i] === '　' || text[i] === '\n' || text[i] === '\r')) {
            i++;
        }

        const noRotateRegex = /\p{sc=Han}|[ぁ-ㇿ\u3100-\u312F\u31A0-\u31BF\u02D9\u02CA\u02C7\u02CB①-⑽㈪-㏟、。々〆︐-･]/u;
        const forceRotateRegex = /^[(){}\[\]〈〉《》「」『』【】〔〕〖〗〘〙〚〛〜︗︘︵︶︷︸︹︺︻︼︽︾︿﹀﹁﹂﹃﹄﹇﹈﹙﹚﹛﹜﹝﹞（）［］｛｝～｟｠｢｣—…｜～]$/;
        const tocRegex = /^\s*(第[零一二三四五六七八九十百千萬0-9０-９]+[章回節卷]|Chapter\s*[0-9]+|正文|楔子|前言|番外)/i;

        let inChapterTitle = false;
        
        // Initial check for the first line
        let firstLineEnd = i;
        while (firstLineEnd < text.length && text[firstLineEnd] !== '\n' && text[firstLineEnd] !== '\r') firstLineEnd++;
        if (firstLineEnd - i < 50 && tocRegex.test(text.slice(i, firstLineEnd))) {
            inChapterTitle = true;
            // Add initial 2 line spacing for the very first chapter if it's right at the start
            for (let j = 0; j < 2; j++) {
                if (mode === 'vertical') { x -= lineHeight; y = startY; } else { y += lineHeight; x = startX; }
            }
        }

        while (i < text.length) {
            const char = text[i];
            
            if (char === '\n') {
                let newlineCount = 1;
                let peek = i + 1;
                while (peek < text.length) {
                    const pc = text[peek];
                    if (pc === '\n') {
                        newlineCount++;
                        peek++;
                    } else if (pc === ' ' || pc === '　' || pc === '\t' || pc === '\r') {
                        peek++;
                    } else {
                        break;
                    }
                }

                let nextLineEnd = peek;
                while (nextLineEnd < text.length && text[nextLineEnd] !== '\n' && text[nextLineEnd] !== '\r') nextLineEnd++;
                const nextLine = text.slice(peek, nextLineEnd);
                const isNextLineChapterTitle = nextLine.length < 50 && tocRegex.test(nextLine);

                if (!justAutoWrapped) {
                    const oldX = x;
                    const oldY = y;
                    if (mode === 'vertical') {
                        x -= lineHeight; y = startY;
                    } else {
                        y += lineHeight; x = startX;
                    }
                    drawOps.push({ char: '\n', x: oldX, y: oldY, isControl: true, charIndex: i });
                }
                
                if (newlineCount > 4) {
                    for (let j = 0; j < newlineCount - 1; j++) {
                        if (mode === 'vertical') {
                            x -= lineHeight; y = startY;
                        } else {
                            y += lineHeight; x = startX;
                        }
                    }
                }
                
                if (isNextLineChapterTitle) {
                    for (let j = 0; j < 2; j++) {
                        if (mode === 'vertical') {
                            x -= lineHeight; y = startY;
                        } else {
                            y += lineHeight; x = startX;
                        }
                    }
                }

                justAutoWrapped = false;
                inChapterTitle = isNextLineChapterTitle;
                i = peek;
                continue;
            }
            if (char === '\r') { i++; continue; }
            
            justAutoWrapped = false;

            let segment = char;
            let type = 'normal';
            let isRotated = false;

            if (mode === 'vertical') {
                if (forceRotateRegex.test(char)) {
                    isRotated = true;
                    type = 'rotated';
                    i++;
                } else if (noRotateRegex.test(char)) {
                    isRotated = false;
                    type = 'normal';
                    i++;
                } else {
                    // Fallback logic, group them
                    let peek = i + 1;
                    while (peek < text.length) {
                        const pc = text[peek];
                        if (pc === '\n' || pc === '\r' || pc === ' ' || pc === '　' || pc === '\t') break;
                        if (forceRotateRegex.test(pc) || noRotateRegex.test(pc)) break;
                        peek++;
                    }
                    segment = text.slice(i, peek);
                    
                    if (segment.length === 1) {
                        isRotated = false;
                        type = 'normal';
                    } else if (segment.length === 2 && /^[0-9]{2}$/.test(segment)) {
                        isRotated = false;
                        type = 'tate-chu-yoko';
                    } else {
                        isRotated = true;
                        type = 'rotated';
                    }
                    i = peek;
                }
            } else {
                isRotated = false;
                type = 'normal';
                
                // Group normal text for faster horizontal rendering? Optional, but let's do it for consistency.
                let peek = i + 1;
                while (peek < text.length) {
                    const pc = text[peek];
                    if (pc === '\n' || pc === '\r') break;
                    // Only group ASCII to avoid line wrap issues in horizontal mode? Actually horizontal is not the focus now.
                    // Just render char by char in horizontal to maintain safe word wrapping.
                    break; 
                }
                i++;
            }

            let advanceW = fontSize; 
            let advanceH = fontSize; 
            
            if (mode === 'vertical') {
                if (type === 'rotated') {
                    advanceH = segment.length === 1 ? fontSize : this.ctx.measureText(segment).width;
                } else if (type === 'tate-chu-yoko') {
                    advanceH = fontSize; 
                } else {
                    advanceH = fontSize; 
                }
                
                // Add 1px buffer to prevent sub-pixel cutting at the bottom
                if (y + advanceH > ch - margins.bottom - padY - 1) {
                    x -= lineHeight; 
                    y = margins.top + padY;
                    justAutoWrapped = true;
                }
                drawOps.push({ char: segment, x, y, isRotated, type, charIndex: i - segment.length, isBold: inChapterTitle });
                y += advanceH + charSpacing;
            } else {
                advanceW = this.ctx.measureText(segment).width;
                // Add 1px buffer to prevent sub-pixel cutting at the right edge
                if (x + advanceW > cw - margins.right - padX - 1) {
                    y += lineHeight; 
                    x = margins.left + padX;
                    justAutoWrapped = true;
                }
                drawOps.push({ char: segment, x, y, isRotated, type, charIndex: i - segment.length, isBold: inChapterTitle });
                x += advanceW + charSpacing;
            }
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

    drawOperations(drawOps, scrollOffset, fontSize, mode, cw, ch, fontFamily = 'sans-serif', margins = { top: 0, bottom: 0, left: 0, right: 0 }) {
        const dpr = Math.max(window.devicePixelRatio || 1, 2); // Match app.js strict retina policy
        
        // Reset transform to identity matrix to guarantee full clear Rect works
        this.ctx.setTransform(1, 0, 0, 1, 0, 0); 
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        this.ctx.scale(dpr, dpr);
        this.ctx.save();
        
        // Clip to margin area so text doesn't spill over
        this.ctx.beginPath();
        this.ctx.rect(margins.left, margins.top, cw - margins.left - margins.right, ch - margins.top - margins.bottom);
        this.ctx.clip();
        
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
            
            if (op.isControl) continue;
            
            const coord = mode === 'vertical' ? op.x : op.y;
            
            // Fast culling
            if (coord > visibleMax) {
                if (mode === 'horizontal') break; 
            }
            if (coord < visibleMin) {
                if (mode === 'vertical') break; 
            }

            if (coord >= visibleMin && coord <= visibleMax) {
                this.ctx.font = op.isBold ? `bold ${fontSize}px ${fontFamily}` : `${fontSize}px ${fontFamily}`;
                
                if (op.type === 'rotated') {
                    this.ctx.save();
                    if (op.char.length === 1) {
                        this.ctx.translate(op.x + (fontSize / 2), op.y + (fontSize / 2));
                        this.ctx.rotate(Math.PI / 2);
                        this.ctx.fillText(op.char, -fontSize / 2, -fontSize / 2);
                    } else {
                        this.ctx.translate(op.x + (fontSize / 2), op.y);
                        this.ctx.rotate(Math.PI / 2);
                        this.ctx.textBaseline = 'middle';
                        this.ctx.fillText(op.char, 0, 0);
                    }
                    this.ctx.restore();
                } else if (op.type === 'tate-chu-yoko') {
                    const w = this.ctx.measureText(op.char).width;
                    let drawX = op.x + (fontSize - w) / 2;
                    this.ctx.fillText(op.char, drawX, op.y, fontSize);
                } else {
                    let drawX = op.x;
                    if (mode === 'vertical') {
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
