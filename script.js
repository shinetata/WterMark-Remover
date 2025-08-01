class WatermarkRemover {
    constructor() {
        this.canvas = document.getElementById('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.overlayCanvas = document.getElementById('overlayCanvas');
        this.overlayCtx = this.overlayCanvas.getContext('2d');
        
        this.currentTool = 'clone';
        this.brushSize = 20;
        this.isDrawing = false;
        this.history = [];
        this.historyIndex = -1;
        this.maxHistory = 20;
        
        this.sourcePoint = null; // 克隆工具的源点
        this.originalImageData = null; // 保存原图
        
        this.initEventListeners();
        this.updateBrushSizeDisplay();
    }
    
    initEventListeners() {
        // 文件上传
        const fileInput = document.getElementById('fileInput');
        const uploadArea = document.getElementById('uploadArea');
        
        fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        
        // 拖拽上传
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });
        
        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });
        
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.loadImage(files[0]);
            }
        });
        
        // 工具选择
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentTool = btn.dataset.tool;
                this.sourcePoint = null; // 重置源点
            });
        });
        
        // 画笔大小
        const brushSizeSlider = document.getElementById('brushSize');
        brushSizeSlider.addEventListener('input', (e) => {
            this.brushSize = parseInt(e.target.value);
            this.updateBrushSizeDisplay();
        });
        
        // Canvas 事件
        this.canvas.addEventListener('mousedown', (e) => this.startDrawing(e));
        this.canvas.addEventListener('mousemove', (e) => this.draw(e));
        this.canvas.addEventListener('mouseup', () => this.stopDrawing());
        this.canvas.addEventListener('mouseout', () => this.stopDrawing());
        
        // 触摸事件 (移动端)
        this.canvas.addEventListener('touchstart', (e) => this.handleTouch(e, 'start'));
        this.canvas.addEventListener('touchmove', (e) => this.handleTouch(e, 'move'));
        this.canvas.addEventListener('touchend', (e) => this.handleTouch(e, 'end'));
        
        // 操作按钮
        document.getElementById('undoBtn').addEventListener('click', () => this.undo());
        document.getElementById('redoBtn').addEventListener('click', () => this.redo());
        document.getElementById('resetBtn').addEventListener('click', () => this.reset());
        document.getElementById('backBtn').addEventListener('click', () => this.goBack());
        document.getElementById('saveBtn').addEventListener('click', () => this.saveImage());
        
        // 防止默认的触摸行为
        document.addEventListener('touchmove', (e) => {
            if (e.target === this.canvas) {
                e.preventDefault();
            }
        }, { passive: false });
        
        // 监听窗口大小变化
        window.addEventListener('resize', () => {
            if (this.originalImageData) {
                // 重新计算canvas尺寸
                const img = new Image();
                img.onload = () => {
                    this.setupCanvas(img);
                };
                img.src = this.canvas.toDataURL();
            }
        });
    }
    
    handleFileSelect(e) {
        const file = e.target.files[0];
        if (file) {
            this.loadImage(file);
        }
    }
    
    loadImage(file) {
        if (!file.type.startsWith('image/')) {
            this.showToast('请选择图片文件', 'error');
            return;
        }
        
        this.showLoading(true);
        
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                console.log('图片加载成功:', img.width, 'x', img.height);
                this.setupCanvas(img);
                this.showEditor();
                this.showLoading(false);
                this.showToast(`图片加载成功 (${img.width}x${img.height})`, 'success');
            };
            img.onerror = () => {
                this.showLoading(false);
                this.showToast('图片加载失败', 'error');
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }
    
    setupCanvas(img) {
        // 计算适合屏幕的尺寸
        const containerWidth = window.innerWidth - 40;
        const containerHeight = window.innerHeight * 0.6;
        
        let { width, height } = this.calculateSize(img.width, img.height, containerWidth, containerHeight);
        
        // 设置canvas尺寸
        this.canvas.width = width;
        this.canvas.height = height;
        this.overlayCanvas.width = width;
        this.overlayCanvas.height = height;
        
        // 绘制图片
        this.ctx.drawImage(img, 0, 0, width, height);
        
        // 保存原图数据
        this.originalImageData = this.ctx.getImageData(0, 0, width, height);
        
        // 保存到历史
        this.saveState();
        
        // 更新canvas容器的样式以匹配实际尺寸
        this.updateCanvasContainerSize(width, height);
    }
    
    calculateSize(imgWidth, imgHeight, maxWidth, maxHeight) {
        let width = imgWidth;
        let height = imgHeight;
        
        const aspectRatio = imgWidth / imgHeight;
        
        if (width > maxWidth) {
            width = maxWidth;
            height = width / aspectRatio;
        }
        
        if (height > maxHeight) {
            height = maxHeight;
            width = height * aspectRatio;
        }
        
        return { width: Math.round(width), height: Math.round(height) };
    }
    
    updateCanvasContainerSize(canvasWidth, canvasHeight) {
        const container = document.querySelector('.canvas-container');
        if (container) {
            // 设置容器的最小高度为canvas的实际高度
            container.style.minHeight = `${canvasHeight}px`;
            container.style.height = `${canvasHeight}px`;
        }
    }
    
    getEventPos(e) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    }
    
    handleTouch(e, type) {
        e.preventDefault();
        
        if (e.touches.length > 1) return; // 忽略多点触摸
        
        const touch = e.touches[0] || e.changedTouches[0];
        const mouseEvent = new MouseEvent(
            type === 'start' ? 'mousedown' : type === 'move' ? 'mousemove' : 'mouseup',
            {
                clientX: touch.clientX,
                clientY: touch.clientY
            }
        );
        
        if (type === 'start') {
            this.startDrawing(mouseEvent);
        } else if (type === 'move') {
            this.draw(mouseEvent);
        } else {
            this.stopDrawing();
        }
    }
    
    startDrawing(e) {
        this.isDrawing = true;
        const pos = this.getEventPos(e);
        
        if (this.currentTool === 'clone') {
            if (!this.sourcePoint) {
                // 第一次点击设置源点
                this.sourcePoint = pos;
                this.showClonePreview(pos);
                this.showToast('已设置源点，现在选择要修复的区域', 'success');
                return;
            }
        }
        
        this.draw(e);
    }
    
    draw(e) {
        if (!this.isDrawing) return;
        
        const pos = this.getEventPos(e);
        
        switch (this.currentTool) {
            case 'clone':
                this.cloneTool(pos);
                break;
            case 'blur':
                this.blurTool(pos);
                break;
            case 'fill':
                this.fillTool(pos);
                break;
            case 'eraser':
                this.eraserTool(pos);
                break;
        }
    }
    
    stopDrawing() {
        if (this.isDrawing) {
            this.isDrawing = false;
            this.saveState();
            this.clearOverlay();
        }
    }
    
    cloneTool(pos) {
        if (!this.sourcePoint) return;
        
        const radius = this.brushSize / 2;
        
        // 获取源区域的图像数据
        const sourceX = this.sourcePoint.x - radius;
        const sourceY = this.sourcePoint.y - radius;
        const size = this.brushSize;
        
        try {
            const sourceData = this.ctx.getImageData(sourceX, sourceY, size, size);
            
            // 创建圆形遮罩
            const tempCanvas = document.createElement('canvas');
            const tempCtx = tempCanvas.getContext('2d');
            tempCanvas.width = size;
            tempCanvas.height = size;
            
            // 绘制圆形遮罩
            tempCtx.globalCompositeOperation = 'source-over';
            tempCtx.putImageData(sourceData, 0, 0);
            
            tempCtx.globalCompositeOperation = 'destination-in';
            tempCtx.beginPath();
            tempCtx.arc(radius, radius, radius, 0, Math.PI * 2);
            tempCtx.fill();
            
            // 应用到目标位置
            this.ctx.globalCompositeOperation = 'source-over';
            this.ctx.drawImage(tempCanvas, pos.x - radius, pos.y - radius);
            
        } catch (err) {
            console.warn('克隆工具操作超出边界');
        }
    }
    
    blurTool(pos) {
        const radius = this.brushSize / 2;
        const size = this.brushSize;
        
        try {
            const imageData = this.ctx.getImageData(pos.x - radius, pos.y - radius, size, size);
            const blurredData = this.applyBlur(imageData, 3);
            
            // 创建圆形遮罩
            const tempCanvas = document.createElement('canvas');
            const tempCtx = tempCanvas.getContext('2d');
            tempCanvas.width = size;
            tempCanvas.height = size;
            
            tempCtx.putImageData(blurredData, 0, 0);
            
            tempCtx.globalCompositeOperation = 'destination-in';
            tempCtx.beginPath();
            tempCtx.arc(radius, radius, radius, 0, Math.PI * 2);
            tempCtx.fill();
            
            this.ctx.drawImage(tempCanvas, pos.x - radius, pos.y - radius);
        } catch (err) {
            console.warn('模糊工具操作超出边界');
        }
    }
    
    fillTool(pos) {
        // 获取周围像素的平均颜色
        const radius = this.brushSize / 2;
        const sampleSize = Math.min(this.brushSize * 2, 50);
        
        try {
            const imageData = this.ctx.getImageData(
                pos.x - sampleSize/2, 
                pos.y - sampleSize/2, 
                sampleSize, 
                sampleSize
            );
            
            const avgColor = this.getAverageColor(imageData);
            
            this.ctx.fillStyle = `rgb(${avgColor.r}, ${avgColor.g}, ${avgColor.b})`;
            this.ctx.beginPath();
            this.ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
            this.ctx.fill();
        } catch (err) {
            console.warn('填充工具操作超出边界');
        }
    }
    
    eraserTool(pos) {
        if (!this.originalImageData) return;
        
        const radius = this.brushSize / 2;
        const size = this.brushSize;
        
        try {
            // 从原图获取数据
            const originalData = this.ctx.createImageData(size, size);
            const startX = Math.max(0, pos.x - radius);
            const startY = Math.max(0, pos.y - radius);
            
            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    const srcX = startX + x;
                    const srcY = startY + y;
                    
                    if (srcX < this.canvas.width && srcY < this.canvas.height) {
                        const srcIndex = (srcY * this.canvas.width + srcX) * 4;
                        const destIndex = (y * size + x) * 4;
                        
                        // 检查是否在圆形区域内
                        const dx = x - radius;
                        const dy = y - radius;
                        if (dx * dx + dy * dy <= radius * radius) {
                            originalData.data[destIndex] = this.originalImageData.data[srcIndex];
                            originalData.data[destIndex + 1] = this.originalImageData.data[srcIndex + 1];
                            originalData.data[destIndex + 2] = this.originalImageData.data[srcIndex + 2];
                            originalData.data[destIndex + 3] = this.originalImageData.data[srcIndex + 3];
                        }
                    }
                }
            }
            
            this.ctx.putImageData(originalData, pos.x - radius, pos.y - radius);
        } catch (err) {
            console.warn('橡皮擦工具操作超出边界');
        }
    }
    
    applyBlur(imageData, radius) {
        const data = imageData.data;
        const width = imageData.width;
        const height = imageData.height;
        const output = new ImageData(width, height);
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let r = 0, g = 0, b = 0, a = 0;
                let count = 0;
                
                for (let dy = -radius; dy <= radius; dy++) {
                    for (let dx = -radius; dx <= radius; dx++) {
                        const ny = y + dy;
                        const nx = x + dx;
                        
                        if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
                            const index = (ny * width + nx) * 4;
                            r += data[index];
                            g += data[index + 1];
                            b += data[index + 2];
                            a += data[index + 3];
                            count++;
                        }
                    }
                }
                
                const index = (y * width + x) * 4;
                output.data[index] = r / count;
                output.data[index + 1] = g / count;
                output.data[index + 2] = b / count;
                output.data[index + 3] = a / count;
            }
        }
        
        return output;
    }
    
    getAverageColor(imageData) {
        const data = imageData.data;
        let r = 0, g = 0, b = 0;
        let count = 0;
        
        for (let i = 0; i < data.length; i += 4) {
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
            count++;
        }
        
        return {
            r: Math.round(r / count),
            g: Math.round(g / count),
            b: Math.round(b / count)
        };
    }
    
    showClonePreview(pos) {
        this.clearOverlay();
        this.overlayCtx.strokeStyle = '#ff4444';
        this.overlayCtx.lineWidth = 2;
        this.overlayCtx.beginPath();
        this.overlayCtx.arc(pos.x, pos.y, this.brushSize / 2, 0, Math.PI * 2);
        this.overlayCtx.stroke();
        
        // 显示十字标记
        this.overlayCtx.beginPath();
        this.overlayCtx.moveTo(pos.x - 10, pos.y);
        this.overlayCtx.lineTo(pos.x + 10, pos.y);
        this.overlayCtx.moveTo(pos.x, pos.y - 10);
        this.overlayCtx.lineTo(pos.x, pos.y + 10);
        this.overlayCtx.stroke();
    }
    
    clearOverlay() {
        this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
    }
    
    saveState() {
        // 限制历史记录数量
        if (this.historyIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.historyIndex + 1);
        }
        
        if (this.history.length >= this.maxHistory) {
            this.history.shift();
        } else {
            this.historyIndex++;
        }
        
        this.history.push(this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height));
    }
    
    undo() {
        if (this.historyIndex > 0) {
            this.historyIndex--;
            this.ctx.putImageData(this.history[this.historyIndex], 0, 0);
            this.sourcePoint = null; // 重置源点
            this.clearOverlay();
        }
    }
    
    redo() {
        if (this.historyIndex < this.history.length - 1) {
            this.historyIndex++;
            this.ctx.putImageData(this.history[this.historyIndex], 0, 0);
            this.sourcePoint = null; // 重置源点
            this.clearOverlay();
        }
    }
    
    reset() {
        if (this.originalImageData) {
            this.ctx.putImageData(this.originalImageData, 0, 0);
            this.history = [this.originalImageData];
            this.historyIndex = 0;
            this.sourcePoint = null;
            this.clearOverlay();
            this.showToast('已重置到原图', 'success');
        }
    }
    
    goBack() {
        document.getElementById('uploadSection').style.display = 'block';
        document.getElementById('editorSection').style.display = 'none';
        this.sourcePoint = null;
        this.clearOverlay();
    }
    
    showEditor() {
        document.getElementById('uploadSection').style.display = 'none';
        document.getElementById('editorSection').style.display = 'block';
    }
    
    saveImage() {
        try {
            // 创建下载链接
            this.canvas.toBlob((blob) => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `watermark-removed-${Date.now()}.png`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                
                this.showToast('图片已保存到下载文件夹', 'success');
            }, 'image/png', 0.9);
        } catch (err) {
            this.showToast('保存失败，请重试', 'error');
        }
    }
    
    updateBrushSizeDisplay() {
        document.getElementById('brushSizeValue').textContent = `${this.brushSize}px`;
    }
    
    showLoading(show) {
        document.getElementById('loading').style.display = show ? 'flex' : 'none';
    }
    
    showToast(message, type = 'info') {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.className = `toast ${type} show`;
        
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }
}

// 初始化应用
document.addEventListener('DOMContentLoaded', () => {
    new WatermarkRemover();
}); 