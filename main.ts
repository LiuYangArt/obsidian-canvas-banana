import { App, ItemView, Plugin, PluginSettingTab, Setting, setIcon, setTooltip, TFile } from 'obsidian';
import type { Canvas, CanvasNode, CanvasCoords } from './types';
import { CanvasConverter, ConvertedNode } from './canvas-converter';
import { ApiManager } from './api-manager';
import { IntentResolver, ResolvedIntent } from './intent-resolver';

// ========== 插件设置接口 ==========
export interface CanvasAISettings {
    openRouterApiKey: string;
    openRouterBaseUrl: string;
    textModel: string;
    imageModel: string;
    imageCompressionQuality: number;  // WebP compression quality (0-100)
    imageMaxSize: number;  // Max width/height for WebP output
}

const DEFAULT_SETTINGS: CanvasAISettings = {
    openRouterApiKey: '',
    openRouterBaseUrl: 'https://openrouter.ai/api/v1/chat/completions',
    textModel: 'google/gemini-2.5-flash-preview',
    imageModel: 'google/gemini-2.5-flash-image-preview',
    imageCompressionQuality: 80,  // Default 80% quality
    imageMaxSize: 2048  // Default max size
};

// ========== 悬浮面板模式 ==========
type PaletteMode = 'chat' | 'image';

// AI Button ID constant for popup menu
const AI_SPARKLES_BUTTON_ID = 'canvas-ai-sparkles';

// ========== 悬浮面板组件 ==========
class FloatingPalette {
    private containerEl: HTMLElement;
    private currentMode: PaletteMode = 'chat';
    private promptInput: HTMLTextAreaElement;
    private isVisible: boolean = false;
    private currentParent: HTMLElement | null = null;
    private onClose: (() => void) | null = null;
    private onDebug: (() => void) | null = null;
    private onGenerate: ((prompt: string, mode: PaletteMode) => Promise<void>) | null = null;
    private apiManager: ApiManager;
    private isGenerating: boolean = false;

    constructor(apiManager: ApiManager, onDebugCallback?: () => void) {
        this.apiManager = apiManager;
        this.onDebug = onDebugCallback || null;
        this.containerEl = this.createPaletteDOM();
        this.promptInput = this.containerEl.querySelector('.canvas-ai-prompt-input') as HTMLTextAreaElement;
    }

    /**
     * Set the generate callback
     */
    setOnGenerate(callback: (prompt: string, mode: PaletteMode) => Promise<void>): void {
        this.onGenerate = callback;
    }

    /**
     * 创建面板 DOM 结构
     */
    private createPaletteDOM(): HTMLElement {
        const container = document.createElement('div');
        container.addClass('canvas-ai-palette');
        container.style.display = 'none';

        // 阻止点击事件冒泡，避免失去 Canvas 选中状态
        container.addEventListener('mousedown', (e) => e.stopPropagation());
        container.addEventListener('click', (e) => e.stopPropagation());

        container.innerHTML = `
            <div class="canvas-ai-palette-header">
                <div class="canvas-ai-tabs">
                    <button class="canvas-ai-tab active" data-mode="chat">💬 Chat</button>
                    <button class="canvas-ai-tab" data-mode="image">🎨 Image</button>
                </div>
                <button class="canvas-ai-close-btn">×</button>
            </div>
            <div class="canvas-ai-palette-body">
                <textarea 
                    class="canvas-ai-prompt-input" 
                    placeholder="Ask a question about selected notes..."
                    rows="4"
                ></textarea>
            </div>
            <div class="canvas-ai-palette-footer">
                <span class="canvas-ai-context-preview"></span>
                <div class="canvas-ai-btn-group">
                    <button class="canvas-ai-debug-btn">Debug</button>
                    <button class="canvas-ai-generate-btn">Generate</button>
                </div>
            </div>
        `;

        // 绑定 Tab 切换事件
        const tabs = container.querySelectorAll('.canvas-ai-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.removeClass('active'));
                tab.addClass('active');
                this.currentMode = tab.getAttribute('data-mode') as PaletteMode;
                this.updatePlaceholder();
            });
        });

        // 绑定关闭按钮
        const closeBtn = container.querySelector('.canvas-ai-close-btn');
        closeBtn?.addEventListener('click', () => {
            this.hide();
            this.onClose?.();
        });

        // 绑定 Debug 按钮
        const debugBtn = container.querySelector('.canvas-ai-debug-btn');
        debugBtn?.addEventListener('click', () => {
            this.onDebug?.();
        });

        // 绑定生成按钮
        const generateBtn = container.querySelector('.canvas-ai-generate-btn');
        generateBtn?.addEventListener('click', () => this.handleGenerate());

        return container;
    }

    /**
     * 更新输入框提示文本
     */
    private updatePlaceholder(): void {
        if (this.currentMode === 'chat') {
            this.promptInput.placeholder = 'Ask a question about selected notes...';
        } else {
            this.promptInput.placeholder = 'Describe the image, or leave empty to use selected text...';
        }
    }

    /**
     * 更新上下文预览信息
     */
    updateContextPreview(nodeCount: number, imageCount: number, textCount: number): void {
        const preview = this.containerEl.querySelector('.canvas-ai-context-preview');
        if (preview) {
            if (nodeCount === 0) {
                preview.textContent = '';
            } else {
                const parts: string[] = [];
                if (imageCount > 0) parts.push(`${imageCount} Image`);
                if (textCount > 0) parts.push(`${textCount} Text`);
                preview.textContent = `🔗 ${nodeCount} Nodes Selected (${parts.join(', ')})`;
            }
        }
    }

    /**
     * 处理生成按钮点击
     */
    private async handleGenerate(): Promise<void> {
        const prompt = this.promptInput.value.trim();
        console.log('Canvas AI: Generate clicked');
        console.log('Mode:', this.currentMode);
        console.log('Prompt:', prompt || '(empty - will use fallback)');

        // Note: Empty prompt is now allowed - IntentResolver will handle fallback

        if (this.isGenerating) {
            console.log('Canvas AI: Already generating, please wait...');
            return;
        }

        // Check if API is configured
        if (!this.apiManager.isConfigured()) {
            console.error('Canvas AI: API Key not configured. Please set it in plugin settings.');
            return;
        }

        // Call the onGenerate callback (which will create Ghost Node and handle API call)
        if (this.onGenerate) {
            this.isGenerating = true;
            const generateBtn = this.containerEl.querySelector('.canvas-ai-generate-btn') as HTMLButtonElement;
            if (generateBtn) {
                generateBtn.textContent = 'Generating...';
                generateBtn.disabled = true;
            }

            try {
                // Hide palette and let plugin handle the rest
                this.hide();
                await this.onGenerate(prompt, this.currentMode);
            } finally {
                this.isGenerating = false;
                if (generateBtn) {
                    generateBtn.textContent = 'Generate';
                    generateBtn.disabled = false;
                }
            }
        }
    }

    /**
     * Get current prompt text
     */
    getPrompt(): string {
        return this.promptInput.value.trim();
    }

    /**
     * Clear prompt input
     */
    clearPrompt(): void {
        this.promptInput.value = '';
    }

    /**
     * 显示面板并定位
     * @param x 屏幕 X 坐标
     * @param y 屏幕 Y 坐标
     * @param canvasContainer Canvas 容器元素
     * @param onCloseCallback 关闭时的回调
     */
    show(x: number, y: number, canvasContainer: HTMLElement, onCloseCallback?: () => void): void {
        // 先挂载到容器（如需要），但保持隐藏
        if (this.currentParent !== canvasContainer) {
            this.containerEl.style.display = 'none';
            this.containerEl.remove();
            canvasContainer.appendChild(this.containerEl);
            this.currentParent = canvasContainer;
        }

        // 计算位置
        const containerRect = canvasContainer.getBoundingClientRect();
        const relativeX = x - containerRect.left;
        const relativeY = y - containerRect.top;

        // 先设置位置（面板仍隐藏）
        this.containerEl.style.left = `${relativeX}px`;
        this.containerEl.style.top = `${relativeY}px`;

        // 使用 requestAnimationFrame 确保位置生效后再显示
        requestAnimationFrame(() => {
            this.containerEl.style.display = 'flex';
            this.isVisible = true;
            this.onClose = onCloseCallback || null;

            // 聚焦输入框
            setTimeout(() => this.promptInput.focus(), 50);
        });
    }



    /**
     * 更新面板位置（用于加选场景）
     */
    updatePosition(x: number, y: number, canvasContainer: HTMLElement): void {
        if (!this.isVisible) return;

        const containerRect = canvasContainer.getBoundingClientRect();
        const relativeX = x - containerRect.left;
        const relativeY = y - containerRect.top;

        this.containerEl.style.left = `${relativeX}px`;
        this.containerEl.style.top = `${relativeY}px`;
    }

    /**
     * 隐藏面板
     */
    hide(): void {
        this.containerEl.style.display = 'none';
        this.isVisible = false;
    }

    /**
     * 获取当前是否可见
     */
    get visible(): boolean {
        return this.isVisible;
    }

    /**
     * 清理 DOM
     */
    destroy(): void {
        this.containerEl.remove();
    }
}

// ========== 插件主类 ==========
export default class CanvasAIPlugin extends Plugin {
    settings: CanvasAISettings;

    private floatingPalette: FloatingPalette | null = null;
    private lastSelectionSize: number = 0;
    private lastSelectedIds: Set<string> = new Set();
    private hideTimer: number | null = null;
    private apiManager: ApiManager | null = null;

    async onload() {
        console.log('Canvas AI: 插件加载中...');

        await this.loadSettings();
        this.addSettingTab(new CanvasAISettingTab(this.app, this));

        // 初始化悬浮组件
        this.initFloatingComponents();

        // 注册 Canvas 选中状态监听
        this.registerCanvasSelectionListener();

        console.log('Canvas AI: 插件加载完成');
    }

    onunload() {
        console.log('Canvas AI: 插件卸载中...');

        // 清理 DOM 组件
        this.floatingPalette?.destroy();

        console.log('Canvas AI: 插件已卸载');
    }

    /**
     * 初始化悬浮组件
     */
    private initFloatingComponents(): void {
        // Initialize API Manager
        this.apiManager = new ApiManager(this.settings);

        this.floatingPalette = new FloatingPalette(this.apiManager, () => {
            this.debugSelectedNodes();
        });

        // Set up generate callback for Ghost Node creation
        this.floatingPalette.setOnGenerate(async (prompt: string, mode: PaletteMode) => {
            await this.handleGeneration(prompt, mode);
        });
    }

    /**
     * Handle generation with Ghost Node
     * Uses IntentResolver for intelligent intent parsing (design_doc_v2.md 3.2-3.6)
     */
    private async handleGeneration(userPrompt: string, mode: PaletteMode): Promise<void> {
        const canvasView = this.app.workspace.getActiveViewOfType(ItemView);
        if (!canvasView || canvasView.getViewType() !== 'canvas') {
            console.error('Canvas AI: Not in canvas view');
            return;
        }

        const canvas = (canvasView as any).canvas as Canvas | undefined;
        if (!canvas) {
            console.error('Canvas AI: Canvas not found');
            return;
        }

        const selection = canvas.selection;

        // ========== Use IntentResolver for intelligent parsing ==========
        let intent: ResolvedIntent;
        try {
            intent = await IntentResolver.resolve(
                this.app,
                canvas,
                selection || new Set(),
                userPrompt,
                mode,
                this.settings
            );
        } catch (e) {
            console.error('Canvas AI: Intent resolution failed:', e);
            return;
        }

        // Check if generation is possible
        if (!intent.canGenerate) {
            console.log('Canvas AI: Nothing to generate (no images, no text, no prompt)');
            return;
        }

        // Log warnings
        if (intent.warnings.length > 0) {
            console.warn('Canvas AI: Warnings:', intent.warnings);
        }

        // ========== Calculate position for ghost node (right of selection) ==========
        let nodeX = 100, nodeY = 100;
        if (selection && selection.size > 0) {
            const bbox = this.getSelectionBBox(selection);
            if (bbox) {
                nodeX = bbox.maxX + 50;
                nodeY = bbox.minY;
            }
        }

        // Create Ghost Node
        const ghostNode = this.createGhostNode(canvas, nodeX, nodeY);
        console.log('Canvas AI: Ghost Node created:', ghostNode.id);

        try {
            let response: string;

            if (mode === 'chat') {
                // Chat Mode - use context and instruction
                let systemPrompt = 'You are a helpful AI assistant embedded in an Obsidian Canvas. Answer concisely and use Markdown formatting.';

                if (intent.contextText) {
                    systemPrompt += `\n\n---\nThe user has selected the following content from their canvas:\n\n${intent.contextText}\n\n---\nBased on this context, respond to the user's request.`;
                }

                console.log('Canvas AI: Sending chat request with context');
                if (intent.images.length > 0) {
                    // Convert to simple format for multimodalChat
                    const simpleImages = intent.images.map(img => ({
                        base64: img.base64,
                        mimeType: img.mimeType
                    }));
                    response = await this.apiManager!.multimodalChat(intent.instruction, simpleImages, systemPrompt);
                } else {
                    response = await this.apiManager!.chatCompletion(intent.instruction, systemPrompt);
                }
                console.log('Canvas AI: API Response received');
                this.updateGhostNode(ghostNode, response, false);

            } else {
                // Image Mode - use new generateImageWithRoles
                console.log('Canvas AI: Sending image request with roles');
                console.log('Canvas AI: Instruction:', intent.instruction);
                console.log('Canvas AI: Images with roles:', intent.images.map(i => i.role));

                const base64Image = await this.apiManager!.generateImageWithRoles(
                    intent.instruction,
                    intent.images,
                    intent.contextText,
                    '1:1',
                    '1K'
                );

                // Update Ghost Node to show saving status
                this.updateGhostNode(ghostNode, '💾 Saving image...', false);

                // Save to Vault
                const savedFile = await this.saveImageToVault(base64Image, intent.instruction);
                console.log('Canvas AI: Image saved to', savedFile.path);

                // Replace Ghost Node with Image Node
                this.replaceGhostWithImageNode(canvas, ghostNode, savedFile);
            }
        } catch (error: any) {
            console.error('Canvas AI: API Error:', error.message || error);
            this.updateGhostNode(ghostNode, `❗ Error: ${error.message || 'Unknown error'}`, true);
        }
    }

    /**
     * Save base64 image to vault
     */
    private async saveImageToVault(base64Data: string, prompt: string): Promise<TFile> {
        // Remove data URL prefix if present
        const base64 = base64Data.replace(/^data:image\/\w+;base64,/, "");

        // Convert base64 to buffer
        const buffer = this.base64ToArrayBuffer(base64);

        // Sanitize prompt for filename
        const safePrompt = prompt.replace(/[\\/:*?"<>|]/g, "").slice(0, 30).trim();
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const filename = `AI_Image_${safePrompt}_${timestamp}.png`;

        // Check/Create "Canvas Images" folder in root
        const folderName = "Canvas Images";
        if (!this.app.vault.getAbstractFileByPath(folderName)) {
            await this.app.vault.createFolder(folderName);
        }

        const filePath = `${folderName}/${filename}`;
        return await this.app.vault.createBinary(filePath, buffer);
    }

    /**
     * Helper: Base64 to ArrayBuffer
     */
    private base64ToArrayBuffer(base64: string): ArrayBuffer {
        const binaryString = window.atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }

    /**
     * Replace Ghost Node with real File Node
     */
    private replaceGhostWithImageNode(canvas: Canvas, ghostNode: CanvasNode, file: TFile): void {
        const { x, y, width } = ghostNode;
        // Calculate aspect ratio height if needed, default square for 1:1
        const height = width;

        // Remove ghost
        (canvas as any).removeNode(ghostNode);

        // Create file node
        const fileNode = (canvas as any).createFileNode({
            file: file,
            pos: { x, y, width, height },
            size: { x, y, width, height },
            save: true,
            focus: false
        });

        canvas.requestSave();
    }

    /**
     * Create a ghost node (loading placeholder)
     */
    private createGhostNode(canvas: Canvas, x: number, y: number): CanvasNode {
        const node = canvas.createTextNode({
            pos: { x, y, width: 400, height: 100 },
            size: { x, y, width: 400, height: 100 },
            text: '✨ AI Generating...',
            focus: false,
            save: true
        });

        // Add ghost node styling
        if (node.nodeEl) {
            node.nodeEl.addClass('canvas-ai-ghost-node');
        }

        canvas.requestSave();
        return node;
    }

    /**
     * Update ghost node with response
     * Dynamically resize node height based on content length
     */
    private updateGhostNode(node: CanvasNode, content: string, isError: boolean): void {
        // Remove ghost styling
        if (node.nodeEl) {
            node.nodeEl.removeClass('canvas-ai-ghost-node');
            if (isError) {
                node.nodeEl.addClass('canvas-ai-error-node');
            }
        }

        // Update node text content
        // Access the internal data and update
        (node as any).setText?.(content);

        // Alternative: directly set text property and re-render
        if (!((node as any).setText)) {
            (node as any).text = content;
            node.render?.();
        }

        // ========== Dynamic height adjustment ==========
        // Estimate height based on content:
        // - Count number of lines
        // - Consider average characters per line (approximately 50 chars at 400px width)
        const lines = content.split('\n');
        const lineCount = lines.length;

        // Estimate wrapped lines for long lines
        let totalEstimatedLines = 0;
        const charsPerLine = 50; // Approximate chars per line at 400px width
        for (const line of lines) {
            const lineLen = line.length;
            if (lineLen === 0) {
                totalEstimatedLines += 1; // Empty line
            } else {
                totalEstimatedLines += Math.ceil(lineLen / charsPerLine);
            }
        }

        // Calculate height: ~24px per line, minimum 100px, maximum 600px
        const lineHeight = 24;
        const padding = 40; // Top + bottom padding
        const estimatedHeight = Math.min(
            Math.max(100, totalEstimatedLines * lineHeight + padding),
            600
        );

        // Update node dimensions
        if ((node as any).resize) {
            (node as any).resize({ width: 400, height: estimatedHeight });
        } else {
            // Fallback: directly set dimensions
            node.width = 400;
            node.height = estimatedHeight;
        }

        node.canvas?.requestSave();
        console.log(`Canvas AI: Ghost Node updated, estimated ${totalEstimatedLines} lines, height: ${estimatedHeight}px`);
    }

    /**
     * Get selection bounding box (canvas coordinates)
     */
    private getSelectionBBox(selection: Set<CanvasNode>): CanvasCoords | null {
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        let hasNode = false;

        selection.forEach(node => {
            minX = Math.min(minX, node.x);
            minY = Math.min(minY, node.y);
            maxX = Math.max(maxX, node.x + node.width);
            maxY = Math.max(maxY, node.y + node.height);
            hasNode = true;
        });

        if (!hasNode) return null;
        return { minX, minY, maxX, maxY };
    }

    /**
     * 注册 Canvas 选中状态监听
     */
    private registerCanvasSelectionListener(): void {
        // 监听布局变化（包括选中状态变化）
        this.registerEvent(
            this.app.workspace.on('layout-change', () => {
                this.checkCanvasSelection();
            })
        );

        // 监听活动叶子变化
        this.registerEvent(
            this.app.workspace.on('active-leaf-change', () => {
                this.hideAllFloatingComponents();
            })
        );

        // 监听文件打开（切换文件时隐藏）
        this.registerEvent(
            this.app.workspace.on('file-open', () => {
                this.hideAllFloatingComponents();
            })
        );

        // 使用 requestAnimationFrame 轮询检查选中状态（更及时）
        this.registerInterval(
            window.setInterval(() => {
                this.checkCanvasSelection();
            }, 200)
        );
    }

    /**
     * 检查 Canvas 选中状态
     */
    private checkCanvasSelection(): void {
        const canvasView = this.app.workspace.getActiveViewOfType(ItemView);

        // 检查是否在 Canvas 视图
        if (!canvasView || canvasView.getViewType() !== 'canvas') {
            this.hideAllFloatingComponents();
            return;
        }

        // 获取 Canvas 实例 (使用 any 绕过类型检查)
        const canvas = (canvasView as any).canvas as Canvas | undefined;
        if (!canvas) {
            this.hideAllFloatingComponents();
            return;
        }

        const selection = canvas.selection;
        const selectionSize = selection?.size ?? 0;
        const currentIds = new Set(Array.from(selection || []).map((n: CanvasNode) => n.id));

        // 规则 3: 取消所有选中 -> 面板消失 (防抖处理)
        // 图片节点加选时可能会触发瞬时的 selectionSize === 0，需要防抖
        if (selectionSize === 0) {
            if (this.floatingPalette?.visible && !this.hideTimer) {
                this.hideTimer = window.setTimeout(() => {
                    this.floatingPalette?.hide();
                    this.lastSelectedIds.clear();
                    this.lastSelectionSize = 0;
                    this.hideTimer = null;
                }, 200); // 200ms 缓冲期
            }
            return;
        }

        // 有选中：立即取消正在进行的隐藏倒计时
        if (this.hideTimer) {
            window.clearTimeout(this.hideTimer);
            this.hideTimer = null;
        }

        // 向原生工具条注入按钮
        this.injectAiButtonToPopupMenu(canvas);

        // 如果面板当前是显示状态，检查是否需要自动关闭或更新位置
        if (this.floatingPalette?.visible) {
            // 规则 4: 选中新节点 (无重叠) -> 面板消失
            // (除非上次记录为空，可能是刚初始化)
            if (this.lastSelectedIds.size > 0) {
                let hasOverlap = false;
                for (const id of currentIds) {
                    if (this.lastSelectedIds.has(id)) {
                        hasOverlap = true;
                        break;
                    }
                }

                if (!hasOverlap) {
                    this.floatingPalette.hide();
                    this.lastSelectedIds = currentIds;
                    this.lastSelectionSize = selectionSize;
                    return;
                }
            }

            // 规则 2: 有重叠 (添加/减少选中) -> 更新位置
            const screenBBox = this.getSelectionScreenBBox(selection);
            if (screenBBox) {
                const paletteX = screenBBox.right + 20;
                const paletteY = screenBBox.top;
                this.floatingPalette.updatePosition(paletteX, paletteY, canvas.wrapperEl);
            }
        }

        // 更新上下文预览
        if (this.floatingPalette?.visible) {
            const { imageCount, textCount } = this.countNodeTypes(selection);
            this.floatingPalette.updateContextPreview(selectionSize, imageCount, textCount);
        }

        // 更新状态记录
        this.lastSelectionSize = selectionSize;
        this.lastSelectedIds = currentIds;
    }

    /**
     * 向 Canvas 原生 popup menu 注入 AI 按钮
     */
    private injectAiButtonToPopupMenu(canvas: Canvas): void {
        const menuEl = canvas.menu?.menuEl;
        if (!menuEl) return;

        // 如果已存在，不重复添加
        if (menuEl.querySelector(`#${AI_SPARKLES_BUTTON_ID}`)) return;

        // 创建 AI 按钮
        const aiButton = document.createElement('button');
        aiButton.id = AI_SPARKLES_BUTTON_ID;
        aiButton.classList.add('clickable-icon');
        setIcon(aiButton, 'sparkles');
        setTooltip(aiButton, 'AI Sparkles', { placement: 'top' });

        aiButton.addEventListener('click', (e) => {
            e.stopPropagation();
            this.onSparklesButtonClick();
        });

        // 添加到工具条末尾
        menuEl.appendChild(aiButton);
    }

    /**
     * 获取选中节点的屏幕坐标包围盒
     * 使用节点 DOM 元素的 getBoundingClientRect 获取真实屏幕位置
     */
    private getSelectionScreenBBox(selection: Set<CanvasNode>): DOMRect | null {
        let left = Infinity, top = Infinity;
        let right = -Infinity, bottom = -Infinity;
        let hasValidNode = false;

        selection.forEach(node => {
            // 获取节点 DOM 元素的屏幕坐标
            const nodeEl = node.nodeEl;
            if (nodeEl) {
                const rect = nodeEl.getBoundingClientRect();
                left = Math.min(left, rect.left);
                top = Math.min(top, rect.top);
                right = Math.max(right, rect.right);
                bottom = Math.max(bottom, rect.bottom);
                hasValidNode = true;
            }
        });

        if (!hasValidNode) return null;

        return new DOMRect(left, top, right - left, bottom - top);
    }

    /**
     * 统计节点类型数量
     */
    private countNodeTypes(selection: Set<CanvasNode>): { imageCount: number; textCount: number } {
        let imageCount = 0;
        let textCount = 0;

        selection.forEach(node => {
            if (node.file) {
                // 文件节点，检查是否为图片
                const ext = node.file.extension?.toLowerCase();
                if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) {
                    imageCount++;
                } else {
                    textCount++;
                }
            } else if (node.text !== undefined) {
                textCount++;
            } else if (node.url) {
                textCount++; // 链接节点算作文本
            }
        });

        return { imageCount, textCount };
    }

    /**
     * 调试：打印选中节点的详细信息
     * 用于步骤 2.1 和 2.2 的测试验证
     */
    private async debugSelectedNodes(): Promise<void> {
        const canvasView = this.app.workspace.getActiveViewOfType(ItemView);

        if (!canvasView || canvasView.getViewType() !== 'canvas') {
            console.log('Canvas AI Debug: Not in Canvas view');
            return;
        }

        const canvas = (canvasView as any).canvas as Canvas | undefined;
        if (!canvas) {
            console.log('Canvas AI Debug: Canvas not found');
            return;
        }

        const selection = canvas.selection;
        if (!selection || selection.size === 0) {
            console.log('Canvas AI Debug: No nodes selected');
            return;
        }

        console.group('🔍 Canvas AI Debug: Selected Nodes');

        // 步骤 2.1：打印每个节点的原始信息
        console.group('📋 Raw Node Data');
        selection.forEach((node: CanvasNode) => {
            console.log('---');
            console.log('ID:', node.id);

            if (node.text !== undefined) {
                console.log('Type: Text');
                console.log('Content:', node.text);
            } else if (node.file) {
                console.log('Type: File');
                console.log('File Path:', node.file.path);
                console.log('File Extension:', node.file.extension);
                console.log('File Name:', node.file.name);
            } else if (node.url) {
                console.log('Type: Link');
                console.log('URL:', node.url);
            } else if (node.label !== undefined) {
                console.log('Type: Group');
                console.log('Label:', node.label);
            } else {
                console.log('Type: Unknown');
                console.log('Node Object:', node);
            }
        });
        console.groupEnd();

        // 步骤 2.2：使用 CanvasConverter 进行格式转换（异步）
        console.group('📝 Converted Output');
        const result = await CanvasConverter.convert(this.app, canvas, selection);

        console.log('Converted Nodes:', result.nodes);
        console.log('Converted Edges:', result.edges);
        console.log('\n--- Markdown Output ---\n');
        console.log(result.markdown);
        console.log('\n--- Mermaid Output ---\n');
        console.log(result.mermaid);
        console.groupEnd();

        // ========== 新增：IntentResolver 解析输出 ==========
        console.group('🎨 IntentResolver Output (Image Mode Simulation)');
        try {
            const intent = await IntentResolver.resolve(
                this.app,
                canvas,
                selection,
                '',  // 模拟空输入，测试回退策略
                'image',
                this.settings
            );

            console.log('✅ canGenerate:', intent.canGenerate);

            console.group('📷 Images with Roles');
            intent.images.forEach((img, idx) => {
                console.log(`[${idx + 1}] Role: "${img.role}", MimeType: ${img.mimeType}, Base64 Length: ${img.base64.length}`);
            });
            if (intent.images.length === 0) {
                console.log('(No images in selection)');
            }
            console.groupEnd();

            console.group('📝 Instruction (Fallback Result)');
            console.log('Final Instruction:', intent.instruction);
            console.log('Instruction Length:', intent.instruction.length);
            console.groupEnd();

            console.group('📄 Context Text');
            if (intent.contextText) {
                console.log(intent.contextText);
            } else {
                console.log('(No context text)');
            }
            console.groupEnd();

            if (intent.warnings.length > 0) {
                console.group('⚠️ Warnings');
                intent.warnings.forEach(w => console.warn(w));
                console.groupEnd();
            }

            // 模拟 Payload 结构
            console.group('📦 Simulated API Payload Structure');
            const payloadPreview = {
                model: this.settings.imageModel,
                modalities: ['image', 'text'],
                content_structure: [
                    { type: 'text', text: 'You are an expert creator...' },
                    ...intent.images.map(img => [
                        { type: 'text', text: `[Ref: ${img.role}]` },
                        { type: 'image_url', base64_length: img.base64.length }
                    ]).flat(),
                    intent.contextText ? { type: 'text', text: '[Context]...' } : null,
                    { type: 'text', text: `INSTRUCTION: ${intent.instruction.substring(0, 100)}${intent.instruction.length > 100 ? '...' : ''}` }
                ].filter(Boolean)
            };
            console.log(JSON.stringify(payloadPreview, null, 2));
            console.groupEnd();

        } catch (e) {
            console.error('IntentResolver failed:', e);
        }
        console.groupEnd();

        console.groupEnd();
    }

    /**
     * Sparkles 按钮点击处理
     */
    private onSparklesButtonClick(): void {
        if (!this.floatingPalette) return;

        if (this.floatingPalette.visible) {
            this.floatingPalette.hide();
        } else {
            // 获取当前 Canvas
            const canvasView = this.app.workspace.getActiveViewOfType(ItemView);
            if (!canvasView || canvasView.getViewType() !== 'canvas') return;

            const canvas = (canvasView as any).canvas as Canvas | undefined;
            if (!canvas || canvas.selection.size === 0) return;

            // 获取选中节点位置
            const screenBBox = this.getSelectionScreenBBox(canvas.selection);
            if (!screenBBox) return;

            // 面板位置：选中框右侧 (与 checkCanvasSelection 保持一致)
            const paletteX = screenBBox.right + 20;
            const paletteY = screenBBox.top;

            // 记录当前选中 ID，防止 checkCanvasSelection 误判为切换上下文而自动关闭
            this.lastSelectedIds = new Set(Array.from(canvas.selection).map(n => n.id));
            this.lastSelectionSize = canvas.selection.size;

            // 显示弹窗
            this.floatingPalette.show(paletteX, paletteY, canvas.wrapperEl, () => {
                // 关闭时的回调
            });

        }
    }

    /**
     * 隐藏所有悬浮组件
     */
    private hideAllFloatingComponents(): void {
        this.floatingPalette?.hide();
        this.lastSelectionSize = 0;
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
        // Update ApiManager settings reference
        this.apiManager?.updateSettings(this.settings);
    }
}

// ========== 设置页面 ==========
class CanvasAISettingTab extends PluginSettingTab {
    plugin: CanvasAIPlugin;

    constructor(app: App, plugin: CanvasAIPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass('canvas-ai-settings');

        containerEl.createEl('h2', { text: 'Canvas AI 设置' });

        // OpenRouter 配置区域
        containerEl.createEl('h3', { text: 'OpenRouter API 配置' });

        // API Key with Test Button
        const apiKeySetting = new Setting(containerEl)
            .setName('API Key')
            .setDesc('输入你的 OpenRouter API 密钥 (获取: openrouter.ai/keys)')
            .addText(text => text
                .setPlaceholder('sk-or-v1-...')
                .setValue(this.plugin.settings.openRouterApiKey)
                .onChange(async (value) => {
                    this.plugin.settings.openRouterApiKey = value;
                    await this.plugin.saveSettings();
                }));

        // Add Test Connection button
        const testBtn = apiKeySetting.controlEl.createEl('button', {
            text: '测试连接',
            cls: 'canvas-ai-test-btn'
        });

        const testResultEl = containerEl.createDiv({ cls: 'canvas-ai-test-result' });
        testResultEl.style.display = 'none';

        testBtn.addEventListener('click', async () => {
            testBtn.textContent = '测试中...';
            testBtn.disabled = true;
            testResultEl.style.display = 'none';

            try {
                const apiManager = new ApiManager(this.plugin.settings);
                if (!apiManager.isConfigured()) {
                    throw new Error('请先填写 API Key');
                }
                const response = await apiManager.chatCompletion('Say "Connection successful!" in one line.');

                testBtn.textContent = '✓ 成功';
                testBtn.addClass('success');
                testResultEl.textContent = `✓ 连接成功: ${response.substring(0, 50)}...`;
                testResultEl.removeClass('error');
                testResultEl.addClass('success');
                testResultEl.style.display = 'block';

                setTimeout(() => {
                    testBtn.textContent = '测试连接';
                    testBtn.removeClass('success');
                }, 3000);
            } catch (error: any) {
                testBtn.textContent = '✗ 失败';
                testBtn.addClass('error');
                testResultEl.textContent = `✗ 连接失败: ${error.message}`;
                testResultEl.removeClass('success');
                testResultEl.addClass('error');
                testResultEl.style.display = 'block';

                setTimeout(() => {
                    testBtn.textContent = '测试连接';
                    testBtn.removeClass('error');
                }, 3000);
            } finally {
                testBtn.disabled = false;
            }
        });

        new Setting(containerEl)
            .setName('API Base URL')
            .setDesc('OpenRouter API 端点地址')
            .addText(text => text
                .setPlaceholder('https://openrouter.ai/api/v1/chat/completions')
                .setValue(this.plugin.settings.openRouterBaseUrl)
                .onChange(async (value) => {
                    this.plugin.settings.openRouterBaseUrl = value;
                    await this.plugin.saveSettings();
                }));

        // 模型配置区域
        containerEl.createEl('h3', { text: '模型配置' });

        new Setting(containerEl)
            .setName('Text Generation Model')
            .setDesc('用于 Chat 模式的文本生成模型')
            .addText(text => text
                .setPlaceholder('google/gemini-2.5-flash-preview')
                .setValue(this.plugin.settings.textModel)
                .onChange(async (value) => {
                    this.plugin.settings.textModel = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Image Generation Model')
            .setDesc('用于 Image 模式的图像生成模型')
            .addText(text => text
                .setPlaceholder('google/gemini-2.5-flash-image-preview')
                .setValue(this.plugin.settings.imageModel)
                .onChange(async (value) => {
                    this.plugin.settings.imageModel = value;
                    await this.plugin.saveSettings();
                }));

        // 图片优化区域
        containerEl.createEl('h3', { text: '图片优化' });

        new Setting(containerEl)
            .setName('Image Compression Quality')
            .setDesc('WebP 压缩质量 (0-100)，值越低文件越小但质量也越低，默认 80')
            .addSlider(slider => slider
                .setLimits(0, 100, 1)
                .setValue(this.plugin.settings.imageCompressionQuality)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.imageCompressionQuality = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Image Max Size')
            .setDesc('图片最大尺寸（像素），宽和高都不会超过此值，默认 2048')
            .addText(text => text
                .setPlaceholder('2048')
                .setValue(String(this.plugin.settings.imageMaxSize))
                .onChange(async (value) => {
                    const num = parseInt(value, 10);
                    if (!isNaN(num) && num > 0) {
                        this.plugin.settings.imageMaxSize = num;
                        await this.plugin.saveSettings();
                    }
                }));

        // 关于区域
        containerEl.createEl('h3', { text: '关于' });
        containerEl.createEl('p', {
            text: 'Canvas AI 插件允许你在 Obsidian Canvas 中使用 AI 进行对话、文本生成和图像生成。'
        });
        containerEl.createEl('p', {
            cls: 'setting-item-description',
            text: '数据存储位置: .obsidian/plugins/obsidian-canvas-ai/data.json'
        });
    }
}
