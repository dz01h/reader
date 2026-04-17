const fs = require('fs');
let code = fs.readFileSync('../js/app.js', 'utf8');

// Replace state variables
code = code.replace(
    /this\.pageOffsets = \[0\];\s*this\.currentPageIndex = 0;/,
    `this.drawOps = [];
        this.maxScroll = 0;
        this.scrollOffset = 0;
        
        // Touch Drag State
        this.isDragging = false;
        this.lastDragCoord = 0;
        this.velocity = 0;
        this.lastTime = 0;
        this.inertiaFrameId = null;`
);

// Replace saveProgress
code = code.replace(
    /const charIndex = this\.pageOffsets\[this\.currentPageIndex\] \|\| 0;/,
    `const targetScroll = this.scrollOffset;`
).replace(/this\.savedPositions\[title\] = charIndex;/, `this.savedPositions[title] = targetScroll;`);

// Replace loadBookIntoReader rebuildAndShow target param extraction
code = code.replace(
    /const targetChar = this\.savedPositions\[filename\] \|\| 0;\s*this\.rebuildAndShow\(targetChar\);/,
    `const targetScroll = this.savedPositions[filename] || 0;
        this.rebuildAndShow(targetScroll);`
);

// Replace rebuildAndShow & applyLayoutChange & showPage
const rebuildReg = /rebuildAndShow\([\s\S]*?showPage\([\s\S]*?\}\s*\}\s*applyLayoutChange\(\) \{[\s\S]*?\}/;

const newRebuild = `rebuildAndShow(targetScrollOffset = 0) {
        if (!this.currentBookContent) return;
        
        const cw = this.els.canvas.width / (window.devicePixelRatio || 1);
        const ch = this.els.canvas.height / (window.devicePixelRatio || 1);
        
        // Render whole document
        const { drawOps, maxScroll } = this.engine.layoutDocument(
            this.currentBookContent, 
            this.currentFontSize, 
            this.currentWritingMode,
            cw, ch,
            this.currentLineHeight, 
            this.currentFontFamily
        );
        
        this.drawOps = drawOps;
        this.maxScroll = maxScroll;
        this.scrollOffset = Math.max(0, Math.min(targetScrollOffset, maxScroll));
        
        this.renderCanvas();
        this.els.statusBar.classList.remove('hidden');
    }

    renderCanvas() {
        if (!this.currentBookContent) return;
        
        if (this.scrollOffset < 0) this.scrollOffset = 0;
        if (this.scrollOffset > this.maxScroll) this.scrollOffset = this.maxScroll;
        
        const cw = this.els.canvas.width / (window.devicePixelRatio || 1);
        const ch = this.els.canvas.height / (window.devicePixelRatio || 1);
        
        this.engine.drawOperations(
            this.drawOps, 
            this.scrollOffset, 
            this.currentFontSize, 
            this.currentWritingMode, 
            cw, ch, 
            this.currentFontFamily
        );
        
        const percent = this.maxScroll > 0 ? ((this.scrollOffset / this.maxScroll) * 100).toFixed(3) : 0;
        this.els.pageIndicator.textContent = \`\${percent}%\`;
        this.els.progressSlider.value = percent;
    }

    applyLayoutChange() {
        if (!this.currentBookContent) return;
        // Keep proportional position
        const currentPercent = this.maxScroll > 0 ? this.scrollOffset / this.maxScroll : 0;
        this.rebuildAndShow(0); 
        this.scrollOffset = this.maxScroll * currentPercent;
        this.renderCanvas();
        this.saveProgress();
    }`;

code = code.replace(rebuildReg, newRebuild);

code = code.replace(
    /this\.pageOffsets\s*=\s*\[0\];\s*this\.currentPageIndex\s*=\s*0;/,
    `this.drawOps = []; this.scrollOffset = 0; this.maxScroll = 0;`
);

code = code.replace(
    /const currentCharIndex = this\.pageOffsets\[this\.currentPageIndex\] \|\| 0;\s*this\.rebuildAndShow\(currentCharIndex\);/,
    `const currPercent = this.maxScroll ? this.scrollOffset / this.maxScroll : 0;
            this.rebuildAndShow();
            this.scrollOffset = this.maxScroll * currPercent;
            this.renderCanvas();`
);

// handleQuadClick
code = code.replace(
    /handleQuadClick\(action\) \{[\s\S]*?\}/,
    `handleQuadClick(action) {
        if (!this.currentBookContent) return;
        const cw = this.els.canvas.width / (window.devicePixelRatio || 1);
        const ch = this.els.canvas.height / (window.devicePixelRatio || 1);
        const viewSize = this.currentWritingMode === 'vertical' ? cw : ch;
        const jumpAmt = Math.max(10, viewSize - 40);
        
        this.startInertialScroll(action === 'next' ? jumpAmt : -jumpAmt, 0.2); // Animate jump
    }`
);

// Progress bar changes
code = code.replace(
    /this\.els\.progressSlider\.addEventListener\('change', \(e\) => \{[\s\S]*?this\.rebuildAndShow\(targetChar\);\s*this\.saveProgress\(\);\s*\}\);\s*\}\);\s*\r?\n\s*\}/,
    `this.els.progressSlider.addEventListener('change', (e) => {
            if (!this.currentBookContent) return;
            const percent = parseFloat(e.target.value);
            this.scrollOffset = this.maxScroll * (percent / 100);
            this.renderCanvas();
            this.saveProgress();
        });`
);

fs.writeFileSync('../js/app.js', code);
