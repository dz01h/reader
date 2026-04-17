const fs = require('fs');
let code = fs.readFileSync('../js/app.js', 'utf8');

const eventInjection = `
        // Touch & Mouse scrolling bounds
        this.els.canvas.addEventListener('mousedown', (e) => this.onDragStart(e));
        this.els.canvas.addEventListener('mousemove', (e) => this.onDragMove(e));
        window.addEventListener('mouseup', (e) => this.onDragEnd(e));
        
        this.els.canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) this.onDragStart(e.touches[0]);
        }, { passive: true });
        this.els.canvas.addEventListener('touchmove', (e) => {
            if (e.touches.length === 1 && this.isDragging) this.onDragMove(e.touches[0]);
        }, { passive: false });
        window.addEventListener('touchend', (e) => this.onDragEnd(e));

        this.els.canvas.addEventListener('wheel', (e) => {
            if (!this.currentBookContent) return;
            e.preventDefault();
            this.scrollOffset += this.currentWritingMode === 'vertical' ? -e.deltaX + e.deltaY : e.deltaY;
            this.renderCanvas();
            this.saveProgress();
        }, { passive: false });
`;

code = code.replace(/this\.els\.canvas\.addEventListener\('click',\s*\(e\)\s*=>\s*\{[\s\S]*?\}\);/, (match) => eventInjection + '\n\n' + match);

const methodsInjection = `
    onDragStart(e) {
        if (!this.currentBookContent) return;
        this.isDragging = true;
        this.lastCoord = this.currentWritingMode === 'vertical' ? e.screenX : e.screenY;
        this.lastTime = performance.now();
        this.velocity = 0;
        if (this.inertiaFrameId) cancelAnimationFrame(this.inertiaFrameId);
    }

    onDragMove(e) {
        if (!this.isDragging || !this.currentBookContent) return;
        
        const currentCoord = this.currentWritingMode === 'vertical' ? e.screenX : e.screenY;
        const delta = this.currentWritingMode === 'vertical' ? (currentCoord - this.lastCoord) : (this.lastCoord - currentCoord);
        
        const now = performance.now();
        const dt = Math.max(1, now - this.lastTime);
        
        // Simple moving average tracking
        this.velocity = (delta / dt) * 16.67; 
        
        this.lastCoord = currentCoord;
        this.lastTime = now;
        
        this.scrollOffset += delta;
        this.renderCanvas();
    }

    onDragEnd(e) {
        if (!this.isDragging) return;
        this.isDragging = false;
        
        if (Math.abs(this.velocity) > 1) {
            this.startInertialScroll(this.velocity * 15, 0.92);
        } else {
            this.saveProgress();
        }
    }

    startInertialScroll(totalDisplacement, friction = 0.95) {
        if (!this.currentBookContent) return;
        if (this.inertiaFrameId) cancelAnimationFrame(this.inertiaFrameId);
        
        let currentV = totalDisplacement * (1 - friction);
        
        const loop = () => {
            if (Math.abs(currentV) < 0.5) {
                this.saveProgress();
                return;
            }
            
            this.scrollOffset += currentV;
            this.renderCanvas();
            
            currentV *= friction;
            
            if (this.scrollOffset < 0 || this.scrollOffset > this.maxScroll) {
                currentV *= 0.5; // Bump hard
            }
            
            this.inertiaFrameId = requestAnimationFrame(loop);
        };
        loop();
    }
`;

code = code.replace(/initDOM\(\) \{/, methodsInjection + '\n\n    initDOM() {');

fs.writeFileSync('../js/app.js', code);
