const fs = require('fs');

let appJs = fs.readFileSync('/home/dz0/my_projects/reader/js/app.js', 'utf-8');

// Replace constructor state
appJs = appJs.replace(
    "this.pageOffsets = [0];\n        this.currentPageIndex = 0;",
    "this.drawOps = [];\n        this.maxScroll = 0;\n        this.scrollOffset = 0;\n        this.isDragging = false;\n        this.lastCoord = 0;\n        this.velocity = 0;\n        this.inertiaFrameId = null;\n        this.lastTimestamp = 0;"
);

// Replace saveProgress to save scroll percent instead of charIndex
appJs = appJs.replace(
    /const charIndex = this\.pageOffsets\[this\.currentPageIndex\] \|\| 0;/,
    "const charIndex = this.scrollOffset;"
);

// Replace handleQuadClick to do smooth/instant scroll
appJs = appJs.replace(
    /handleQuadClick\(action\) \{[\s\S]*?\}/,
    `handleQuadClick(action) {
        if (!this.currentBookContent) return;
        const jumpAmt = this.currentWritingMode === 'vertical' ? (this.els.canvas.width / window.devicePixelRatio) - 40 : (this.els.canvas.height / window.devicePixelRatio) - 40;
        
        if (action === 'next') {
            this.animateScrollTo(this.scrollOffset + jumpAmt);
        } else if (action === 'prev') {
            this.animateScrollTo(this.scrollOffset - jumpAmt);
        }
    }`
);

// We need to inject scroll events in bindEvents() and replace rebuildAndShow
fs.writeFileSync('/home/dz0/my_projects/reader/scratch/patched_app.js', appJs);
