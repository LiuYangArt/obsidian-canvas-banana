import { App, ItemView, Plugin, PluginSettingTab, Setting } from 'obsidian';
import type { Canvas, CanvasNode, CanvasCoords } from './types';

// ========== 插件设置接口 ==========
interface CanvasAISettings {
    geminiApiKey: string;
    openRouterApiKey: string;
}

const DEFAULT_SETTINGS: CanvasAISettings = {
    geminiApiKey: '',
    openRouterApiKey: ''
};

// ========== 悬浮面板模式 ==========
type PaletteMode = 'chat' | 'image';

// ========== AI Sparkles 触发按钮 ==========
class AiSparklesButton {
    private containerEl: HTMLElement;
    private buttonEl: HTMLElement;
    private onClick: () => void;

    constructor(onClick: () => void) {
        this.onClick = onClick;
        this.containerEl = document.createElement('div');
        this.containerEl.addClass('canvas-ai-sparkles-container');

        this.buttonEl = document.createElement('button');
        this.buttonEl.addClass('canvas-ai-sparkles-btn');
        this.buttonEl.innerHTML = '✨';
        this.buttonEl.setAttribute('aria-label', 'AI Sparkles');
        this.buttonEl.addEventListener('click', (e) => {
            e.stopPropagation();
            this.onClick();
        });

        this.containerEl.appendChild(this.buttonEl);
    }

    /**
     * 显示按钮并定位到指定坐标
     */
    show(x: number, y: number): void {
        this.containerEl.style.left = `${x}px`;
        this.containerEl.style.top = `${y}px`;
        this.containerEl.style.display = 'flex';

        if (!document.body.contains(this.containerEl)) {
            document.body.appendChild(this.containerEl);
        }
    }

    /**
     * 隐藏按钮
     */
    hide(): void {
        this.containerEl.style.display = 'none';
    }

    /**
     * 清理 DOM
     */
    destroy(): void {
        this.containerEl.remove();
    }
}

// ========== 悬浮面板组件 ==========
class FloatingPalette {
    private containerEl: HTMLElement;
    private currentMode: PaletteMode = 'chat';
    private promptInput: HTMLTextAreaElement;
    private isVisible: boolean = false;

    constructor() {
        this.containerEl = this.createPaletteDOM();
        this.promptInput = this.containerEl.querySelector('.canvas-ai-prompt-input') as HTMLTextAreaElement;
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
                <button class="canvas-ai-generate-btn">Generate</button>
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
        closeBtn?.addEventListener('click', () => this.hide());

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
            this.promptInput.placeholder = 'Describe the image you want to generate...';
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
    private handleGenerate(): void {
        const prompt = this.promptInput.value.trim();
        console.log('Canvas AI: Generate clicked');
        console.log('Mode:', this.currentMode);
        console.log('Prompt:', prompt);

        if (!prompt) {
            console.log('Canvas AI: Empty prompt, skipped');
            return;
        }

        // TODO: 后续阶段实现 API 调用
        console.log('Canvas AI: Ready to send to API (not implemented yet)');
    }

    /**
     * 显示面板并定位
     */
    show(x: number, y: number): void {
        this.containerEl.style.left = `${x}px`;
        this.containerEl.style.top = `${y}px`;
        this.containerEl.style.display = 'flex';
        this.isVisible = true;

        if (!document.body.contains(this.containerEl)) {
            document.body.appendChild(this.containerEl);
        }

        // 聚焦输入框
        setTimeout(() => this.promptInput.focus(), 50);
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

    private sparklesButton: AiSparklesButton | null = null;
    private floatingPalette: FloatingPalette | null = null;
    private lastSelectionSize: number = 0;

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
        this.sparklesButton?.destroy();
        this.floatingPalette?.destroy();

        console.log('Canvas AI: 插件已卸载');
    }

    /**
     * 初始化悬浮组件
     */
    private initFloatingComponents(): void {
        this.floatingPalette = new FloatingPalette();

        this.sparklesButton = new AiSparklesButton(() => {
            this.onSparklesButtonClick();
        });
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

        // 选中状态变化检测
        if (selectionSize === 0) {
            // 无选中，隐藏按钮（但保留已打开的面板一小段时间）
            this.sparklesButton?.hide();
            this.lastSelectionSize = 0;
            return;
        }

        // 有节点被选中，显示 Sparkles 按钮
        if (selectionSize > 0) {
            const bbox = this.getSelectionBBox(selection);
            const canvasRect = canvas.wrapperEl.getBoundingClientRect();

            // 计算按钮位置：选中框右上角
            const buttonX = canvasRect.left + bbox.maxX + 10;
            const buttonY = canvasRect.top + bbox.minY - 20;

            this.sparklesButton?.show(buttonX, buttonY);

            // 更新面板的上下文预览
            if (this.floatingPalette) {
                const { imageCount, textCount } = this.countNodeTypes(selection);
                this.floatingPalette.updateContextPreview(selectionSize, imageCount, textCount);
            }

            this.lastSelectionSize = selectionSize;
        }
    }

    /**
     * 计算选中节点的包围盒
     */
    private getSelectionBBox(selection: Set<CanvasNode>): CanvasCoords {
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        selection.forEach(node => {
            minX = Math.min(minX, node.x);
            minY = Math.min(minY, node.y);
            maxX = Math.max(maxX, node.x + node.width);
            maxY = Math.max(maxY, node.y + node.height);
        });

        return { minX, minY, maxX, maxY };
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
     * Sparkles 按钮点击处理
     */
    private onSparklesButtonClick(): void {
        if (!this.floatingPalette) return;

        if (this.floatingPalette.visible) {
            this.floatingPalette.hide();
        } else {
            // 获取按钮位置，将面板显示在按钮下方
            const canvasView = this.app.workspace.getActiveViewOfType(ItemView);
            if (!canvasView || canvasView.getViewType() !== 'canvas') return;

            const canvas = (canvasView as any).canvas as Canvas | undefined;
            if (!canvas || canvas.selection.size === 0) return;

            const bbox = this.getSelectionBBox(canvas.selection);
            const canvasRect = canvas.wrapperEl.getBoundingClientRect();

            // 面板位置：选中框右侧
            const paletteX = canvasRect.left + bbox.maxX + 20;
            const paletteY = canvasRect.top + bbox.minY;

            this.floatingPalette.show(paletteX, paletteY);
        }
    }

    /**
     * 隐藏所有悬浮组件
     */
    private hideAllFloatingComponents(): void {
        this.sparklesButton?.hide();
        this.floatingPalette?.hide();
        this.lastSelectionSize = 0;
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
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

        containerEl.createEl('h2', { text: 'Canvas AI 设置' });

        // API 配置区域
        containerEl.createEl('h3', { text: 'API 配置' });

        new Setting(containerEl)
            .setName('Gemini API Key')
            .setDesc('输入你的 Google Gemini API 密钥')
            .addText(text => text
                .setPlaceholder('输入 API Key...')
                .setValue(this.plugin.settings.geminiApiKey)
                .onChange(async (value) => {
                    this.plugin.settings.geminiApiKey = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('OpenRouter API Key')
            .setDesc('输入你的 OpenRouter API 密钥（可选）')
            .addText(text => text
                .setPlaceholder('输入 API Key...')
                .setValue(this.plugin.settings.openRouterApiKey)
                .onChange(async (value) => {
                    this.plugin.settings.openRouterApiKey = value;
                    await this.plugin.saveSettings();
                }));

        // 关于区域
        containerEl.createEl('h3', { text: '关于' });
        containerEl.createEl('p', {
            text: 'Canvas AI 插件允许你在 Obsidian Canvas 中使用 Gemini AI 进行对话、文本生成和图像生成。'
        });
    }
}
