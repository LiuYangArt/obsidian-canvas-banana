/**
 * Notes Selection Handler
 * 监听 Notes 编辑器中的文本选中，管理悬浮按钮和面板的显示
 */

import { App, MarkdownView, Editor, TFile, Notice, EventRef } from 'obsidian';
import type CanvasAIPlugin from '../../main';
import { NotesFloatingButton } from './notes-floating-button';
import { NotesEditPalette, NotesPaletteMode } from './notes-edit-palette';
import { SelectionContext } from '../types';
import { DiffModal } from '../ui/modals';
import { buildEditModeSystemPrompt } from '../prompts/edit-mode-prompt';
import { CanvasConverter } from '../canvas/canvas-converter';
import { applyPatches, TextChange } from './text-patcher';
import { t } from '../../lang/helpers';
import { SideBarCoPilotView, VIEW_TYPE_SIDEBAR_COPILOT } from './sidebar-copilot-view';
import { ApiManager } from '../api/api-manager';
import { ApiProvider } from '../settings/settings';
import { NoteImageTaskManager } from './note-image-task-manager';

export interface NotesSelectionContext extends SelectionContext {
    editor: Editor;
    file: TFile;
}

export class NotesSelectionHandler {
    private plugin: CanvasAIPlugin;
    private app: App;
    private floatingButton: NotesFloatingButton;
    private editPalette: NotesEditPalette | null = null;

    // 缓存的选区上下文
    private lastContext: NotesSelectionContext | null = null;

    // 生成状态 - 防止并发任务
    private isGenerating: boolean = false;

    // 选区高亮容器
    private highlightContainer: HTMLElement | null = null;

    // 事件清理
    private selectionChangeHandler: () => void;
    private escapeHandler: (evt: KeyboardEvent) => void;
    private mousedownHandler: (evt: MouseEvent) => void;
    private leafChangeCleanup: EventRef | null = null;

    // 多图并发任务管理器
    private imageTaskManager: NoteImageTaskManager;

    constructor(plugin: CanvasAIPlugin) {
        this.plugin = plugin;
        this.app = plugin.app;

        // 创建 UI 组件
        this.floatingButton = new NotesFloatingButton();

        // 创建任务管理器
        this.imageTaskManager = new NoteImageTaskManager(this.app, this.plugin.settings);
        
        // 只有当 apiManager 存在时才创建 editPalette
        if (this.plugin.apiManager) {
            this.editPalette = new NotesEditPalette(this.app, this.plugin.apiManager);
            this.editPalette.setOnGenerate((prompt, mode) => this.handleGeneration(prompt, mode));
            this.editPalette.setOnClose(() => this.clearSelectionHighlight());
            this.setupCallbacks();
            this.initFromSettings();
        }

        // 设置回调
        this.floatingButton.setOnClick(() => this.onButtonClick());

        // 注册事件监听
        this.registerEventListeners();
    }

    private initFromSettings(): void {
        if (!this.editPalette) return;

        const settings = this.plugin.settings;

        // 使用统一刷新方法
        this.editPalette.refreshFromSettings(
            settings.editPresets || [],
            settings.imagePresets || [],
            settings.quickSwitchTextModels || [],
            settings.paletteEditModel || '',
            settings.quickSwitchImageModels || [],
            settings.paletteImageModel || '',
            settings.defaultResolution || '1K',
            settings.defaultAspectRatio || '1:1'
        );
    }

    /**
     * 设置回调（只在构造函数中调用一次）
     */
    private setupCallbacks(): void {
        if (!this.editPalette) return;

        this.editPalette.setOnEditPresetChange((presets) => {
            this.plugin.settings.editPresets = presets;
            void this.plugin.saveSettings();
        });
        this.editPalette.setOnImagePresetChange((presets) => {
            this.plugin.settings.imagePresets = presets;
            void this.plugin.saveSettings();
        });
        this.editPalette.setOnTextModelChange((modelKey) => {
            this.plugin.settings.paletteEditModel = modelKey;
            void this.plugin.saveSettings();
        });
        this.editPalette.setOnImageModelChange((modelKey) => {
            this.plugin.settings.paletteImageModel = modelKey;
            void this.plugin.saveSettings();
        });
        this.editPalette.setOnImageOptionsChange((options) => {
            this.plugin.settings.defaultResolution = options.resolution;
            this.plugin.settings.defaultAspectRatio = options.aspectRatio;
            void this.plugin.saveSettings();
        });
    }

    private registerEventListeners(): void {
        // 监听选区变化 (使用 document 级别的 selectionchange)
        this.selectionChangeHandler = () => this.checkSelection();
        document.addEventListener('selectionchange', this.selectionChangeHandler);

        // 监听 Escape 键关闭面板
        this.escapeHandler = (evt: KeyboardEvent) => {
            if (evt.key === 'Escape') {
                if (this.editPalette?.visible) {
                    this.editPalette.hide();
                    this.clearSelectionHighlight();
                    evt.preventDefault();
                    evt.stopPropagation();
                }
            }
        };
        document.addEventListener('keydown', this.escapeHandler, true);

        // 监听点击事件，用于捕获选区和关闭面板
        this.mousedownHandler = (evt: MouseEvent) => {
            const target = evt.target as HTMLElement;

            const isPalette = target.closest('.notes-ai-palette');
            const isButton = target.closest('#notes-ai-floating-button');

            if (isButton) {
                // 只在点击按钮且面板未打开时捕获选区
                if (!this.editPalette?.visible) {
                    this.captureContext();
                }
            } else if (!isPalette) {
                // 点击 palette 外部（非按钮）时，隐藏面板
                if (this.editPalette?.visible) {
                    this.editPalette.hide();
                    this.clearSelectionHighlight();
                }
            }
            // 点击 palette 内部时不做任何事，保持现有高亮
        };
        document.addEventListener('mousedown', this.mousedownHandler, true);

        // 监听视图切换，切换到非 MarkdownView 时清理 UI
        this.leafChangeCleanup = this.app.workspace.on('active-leaf-change', () => {
            // 如果正在生成中，不要清理 UI（支持切换到侧栏查看）
            if (this.isGenerating) return;

            const view = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (!view) {
                // 切换到非 Markdown 视图，清理所有 UI
                this.floatingButton.hide();
                this.editPalette?.hide();
                this.clearSelectionHighlight();
                this.lastContext = null;
            }
        });
    }

    private checkSelection(): void {
        // 生成中或面板打开时，不响应选区变化
        if (this.isGenerating || this.editPalette?.visible) {
            return;
        }

        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view || view.getMode() !== 'source') {
            // 不在 Source Mode (Live Preview 或 Reading Mode)
            this.floatingButton.hide();
            return;
        }

        const editor = view.editor;
        const selection = editor.getSelection();

        if (!selection || selection.trim().length === 0) {
            // 没有选中文本
            this.floatingButton.hide();
            return;
        }

        // 有选中文本，显示悬浮按钮
        this.showButtonNearSelection(editor);
    }

    private showButtonNearSelection(editor: Editor): void {
        // 使用 'head' 获取光标当前位置（用户最后交互的位置）
        // 'head' 是光标的实际位置，不管选区方向如何
        // 这样从下往上选时，按钮会显示在用户视线附近
        const headCursor = editor.getCursor('head');

        // 使用 CodeMirror 的坐标转换
        const cm = (editor as unknown as { cm: { coordsAtPos: (pos: number) => { left: number; top: number; bottom: number } } }).cm;
        if (!cm?.coordsAtPos) {
            // Fallback: 使用窗口中心
            this.floatingButton.show(window.innerWidth / 2, window.innerHeight / 2);
            return;
        }

        // 计算文档中的字符偏移
        const doc = editor.getDoc();
        let offset = 0;
        for (let i = 0; i < headCursor.line; i++) {
            offset += doc.getLine(i).length + 1; // +1 for newline
        }
        offset += headCursor.ch;

        const coords = cm.coordsAtPos(offset);
        if (coords) {
            // 计算按钮位置，确保在可视区域内
            let posX = coords.left + 10;
            let posY = coords.bottom + 5;

            // 确保按钮不超出右边界
            const buttonWidth = 32;
            if (posX + buttonWidth > window.innerWidth) {
                posX = window.innerWidth - buttonWidth - 10;
            }

            // 确保按钮不超出下边界，如果超出则显示在上方
            const buttonHeight = 32;
            if (posY + buttonHeight > window.innerHeight) {
                posY = coords.top - buttonHeight - 5;
            }

            // 确保按钮不超出上边界
            if (posY < 10) {
                posY = 10;
            }

            this.floatingButton.show(posX, posY);
        }
    }

    private clearSelectionHighlight(): void {
        // 移除高亮容器
        if (this.highlightContainer) {
            this.highlightContainer.remove();
            this.highlightContainer = null;
        }
        // 移除所有可能带有标记的编辑器容器
        document.querySelectorAll('.notes-ai-selection-active').forEach(el => {
            el.removeClass('notes-ai-selection-active');
        });
    }

    /**
     * 在失去焦点前捕获选区的屏幕位置，创建持久高亮
     * 原理：CodeMirror 6 会在失去焦点时移除 .cm-selectionBackground 元素
     * 所以必须在 mousedown 阶段（焦点还在编辑器时）用 Range.getClientRects() 获取位置
     */
    private captureSelectionHighlight(): void {
        this.clearSelectionHighlight();

        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;

        const range = selection.getRangeAt(0);
        const rects = range.getClientRects();
        if (rects.length === 0) return;

        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) return;

        // 获取 .cm-scroller 作为定位参考（它是滚动容器）
        const scrollerEl = view.containerEl.querySelector('.cm-scroller');
        if (!scrollerEl) return;

        const scrollerRect = scrollerEl.getBoundingClientRect();

        // 创建高亮容器
        this.highlightContainer = document.createElement('div');
        this.highlightContainer.className = 'notes-ai-highlight-container';

        // 为每个矩形创建高亮
        for (let i = 0; i < rects.length; i++) {
            const rect = rects[i];
            // 跳过宽度为0的矩形（换行符等）
            if (rect.width < 1) continue;

            const highlight = document.createElement('div');
            highlight.className = 'notes-ai-highlight-rect';
            // 计算相对于 scroller 的位置，考虑滚动偏移
            const left = rect.left - scrollerRect.left + scrollerEl.scrollLeft;
            const top = rect.top - scrollerRect.top + scrollerEl.scrollTop;
            highlight.style.left = `${left}px`;
            highlight.style.top = `${top}px`;
            highlight.style.width = `${rect.width}px`;
            highlight.style.height = `${rect.height}px`;
            this.highlightContainer.appendChild(highlight);
        }

        scrollerEl.appendChild(this.highlightContainer);
    }

    private captureContext(): void {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view || !view.file) return;

        const editor = view.editor;
        const selection = editor.getSelection();

        if (!selection || selection.trim().length === 0) {
            this.lastContext = null;
            return;
        }

        // 在失去焦点前捕获选区高亮
        this.captureSelectionHighlight();

        const fullText = editor.getValue();
        const fromCursor = editor.getCursor('from');
        const toCursor = editor.getCursor('to');

        // 计算选区在全文中的位置
        const doc = editor.getDoc();
        let fromOffset = 0;
        for (let i = 0; i < fromCursor.line; i++) {
            fromOffset += doc.getLine(i).length + 1;
        }
        fromOffset += fromCursor.ch;

        let toOffset = 0;
        for (let i = 0; i < toCursor.line; i++) {
            toOffset += doc.getLine(i).length + 1;
        }
        toOffset += toCursor.ch;

        this.lastContext = {
            nodeId: view.file.path,
            selectedText: selection,
            preText: fullText.substring(0, fromOffset),
            postText: fullText.substring(toOffset),
            fullText: fullText,
            isExplicit: true,
            editor: editor,
            file: view.file
        };
    }

    private onButtonClick(): void {
        // 确保已捕获上下文
        if (!this.lastContext) {
            this.captureContext();
        }

        if (!this.lastContext || !this.editPalette) {
            return;
        }

        // 标记编辑器容器，让 CSS 保持选区样式
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view) {
            view.containerEl.addClass('notes-ai-selection-active');
        }

        // 获取按钮位置，在按钮右侧显示面板
        const buttonPos = this.floatingButton.getPosition();
        const paletteX = Math.min(buttonPos.x + 10, window.innerWidth - 350);
        const paletteY = Math.max(buttonPos.y - 20, 10);

        // 隐藏按钮，显示面板
        this.floatingButton.hide();
        this.editPalette.show(paletteX, paletteY);
    }

    /**
     * 供快捷键调用的公开方法，检查当前是否有选中文本并打开面板
     * @returns true 如果成功打开面板
     */
    public triggerOpenPalette(): boolean {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view || view.getMode() !== 'source') {
            return false;
        }

        const editor = view.editor;
        const selection = editor.getSelection();
        if (!selection || selection.trim().length === 0) {
            return false;
        }

        // 捕获上下文并打开面板
        this.captureContext();
        if (!this.lastContext || !this.editPalette) {
            return false;
        }

        // 如果面板已打开，则关闭
        if (this.editPalette.visible) {
            this.editPalette.hide();
            this.clearSelectionHighlight();
            return true;
        }

        // 标记编辑器容器
        view.containerEl.addClass('notes-ai-selection-active');

        // 计算面板位置（屏幕中央偏右）
        const paletteX = Math.min(window.innerWidth / 2, window.innerWidth - 350);
        const paletteY = Math.max(100, window.innerHeight / 4);

        this.floatingButton.hide();
        this.editPalette.show(paletteX, paletteY);
        return true;
    }

    /**
     * 获取侧栏 CoPilot 视图（用于同步消息）
     */
    private getSidebarView(): SideBarCoPilotView | null {
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SIDEBAR_COPILOT);
        if (leaves.length > 0) {
            return leaves[0].view as SideBarCoPilotView;
        }
        return null;
    }

    private async handleGeneration(prompt: string, mode: NotesPaletteMode = 'edit'): Promise<void> {
        if (!this.lastContext || !this.plugin.apiManager) {
            return;
        }

        // 根据模式分发到不同的处理器
        if (mode === 'image') {
            return this.handleImageGeneration(prompt);
        }

        // 以下是原有的 edit 模式逻辑
        // 检查任务互斥：生图任务进行中禁止 Edit
        if (this.imageTaskManager.isEditBlocked()) {
            new Notice(t('Edit disabled during image generation'));
            return;
        }

        // 禁止并发任务
        if (this.isGenerating) {
            new Notice(t('Generation in progress'));
            return;
        }

        const context = this.lastContext;
        const { editor, selectedText, preText, postText } = context;
        const enableGlobal = this.plugin.settings.enableGlobalConsistency !== false;

        // 保存选区位置（在异步操作前保存）
        const savedFromCursor = editor.getCursor('from');
        const savedToCursor = editor.getCursor('to');

        // 设置生成状态
        this.isGenerating = true;
        this.floatingButton.setGenerating(true);
        this.floatingButton.show(
            parseInt(this.floatingButton.getElement().style.left) || 100,
            parseInt(this.floatingButton.getElement().style.top) || 100
        );

        // 同步用户消息到侧栏
        const sidebarView = this.getSidebarView();
        if (sidebarView) {
            sidebarView.addExternalMessage('user', prompt);
        }

        try {
            // System Prompt - 根据是否开启全局一致性选择格式
            const systemPrompt = buildEditModeSystemPrompt(
                this.plugin.settings.editSystemPrompt,
                enableGlobal
            );

            // 提取文档中的内嵌图片 ![[image.png]]
            const images = await this.extractDocumentImages(context.fullText, context.file.path);

            // 构建用户消息 - 如果开启全局一致性，包含全文
            let userMessage: string;
            if (enableGlobal) {
                userMessage = `Full document context:\n\`\`\`\n${context.fullText}\n\`\`\`\n\nTarget text to edit (marked selection):\n\`\`\`\n${selectedText}\n\`\`\`\n\nInstruction: ${prompt}`;
            } else {
                userMessage = `Target text to edit:\n\`\`\`\n${selectedText}\n\`\`\`\n\nInstruction: ${prompt}`;
            }

            // 使用 multimodalChat 或 chatCompletion
            let response: string;
            if (images.length > 0) {
                console.debug(`Notes AI: Sending request with ${images.length} images as context`);
                response = await this.plugin.apiManager.multimodalChat(
                    userMessage,
                    images,
                    systemPrompt,
                    1 // temperature
                );
            } else {
                response = await this.plugin.apiManager.chatCompletion(
                    userMessage,
                    systemPrompt,
                    1 // temperature
                );
            }

            // 解析 JSON 响应
            let replacementText = response;
            let globalChanges: TextChange[] = [];
            let summary = '';

            try {
                // 清理可能的 markdown 代码块
                let jsonStr = response.trim();
                if (jsonStr.startsWith('```json')) {
                    jsonStr = jsonStr.slice(7);
                }
                if (jsonStr.startsWith('```')) {
                    jsonStr = jsonStr.slice(3);
                }
                if (jsonStr.endsWith('```')) {
                    jsonStr = jsonStr.slice(0, -3);
                }
                jsonStr = jsonStr.trim();

                const parsed = JSON.parse(jsonStr);
                if (parsed.replacement) {
                    replacementText = parsed.replacement;
                }
                if (parsed.summary) {
                    summary = parsed.summary;
                }
                // 解析全局变更
                if (enableGlobal && Array.isArray(parsed.globalChanges)) {
                    globalChanges = parsed.globalChanges.filter(
                        (c: { original?: string; new?: string }) => c.original && c.new !== undefined
                    );
                    console.debug(`Notes AI: Found ${globalChanges.length} global changes`);
                }
            } catch {
                console.debug('Notes AI: Failed to parse JSON response, using raw text');
            }

            // 生成 summary（如果 AI 没有返回）
            if (!summary) {
                if (globalChanges.length > 0) {
                    summary = t('Applied changes with global updates', { count: globalChanges.length.toString() });
                } else {
                    summary = t('Applied changes');
                }
            }

            // 同步 AI 回复到侧栏
            if (sidebarView) {
                sidebarView.addExternalMessage('assistant', summary);
            }

            // 显示 DiffModal
            const diffContext: SelectionContext = {
                nodeId: context.nodeId,
                selectedText: selectedText,
                preText: preText,
                postText: postText,
                fullText: context.fullText,
                isExplicit: true
            };

            new DiffModal(
                this.app,
                diffContext,
                replacementText,
                () => {
                    // 先替换选区
                    editor.replaceRange(replacementText, savedFromCursor, savedToCursor);

                    // 如果有全局变更，应用它们
                    if (globalChanges.length > 0) {
                        // 获取更新后的全文
                        const currentFullText = editor.getValue();
                        const result = applyPatches(currentFullText, globalChanges);

                        if (result.appliedCount > 0) {
                            editor.setValue(result.text);
                            new Notice(t('Global update completed') + ` (${result.appliedCount})`);
                        }

                        if (result.failedPatches.length > 0) {
                            console.warn('Notes AI: Some global patches failed:', result.failedPatches);
                        }
                    }
                },
                () => {
                    // 取消 - 更新侧栏状态
                    if (sidebarView) {
                        sidebarView.updateLastAssistantMessage(t('Changes rejected by user'));
                    }
                }
            ).open();

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error('Notes AI: Generation error:', message);
            new Notice(`Notes AI Error: ${message}`);
        } finally {
            this.isGenerating = false;
            this.floatingButton.setGenerating(false);
            this.floatingButton.hide();
        }
    }

    /**
     * 提取文档中的内嵌图片 ![[image.png]] 并读取为 base64
     */
    private async extractDocumentImages(
        content: string,
        filePath: string
    ): Promise<{ base64: string; mimeType: string; type: 'image' }[]> {
        const images: { base64: string; mimeType: string; type: 'image' }[] = [];
        
        // 解析 ![[image.png]] 语法
        const regex = /!\[\[([^\]]+\.(png|jpg|jpeg|gif|webp|svg|bmp))\]\]/gi;
        const matches: string[] = [];
        let match;
        while ((match = regex.exec(content)) !== null) {
            matches.push(match[1]);
        }

        if (matches.length === 0) {
            return images;
        }

        const settings = this.plugin.settings;
        const MAX_IMAGES = 14;

        for (const imgPath of matches) {
            if (images.length >= MAX_IMAGES) {
                console.debug(`Notes AI: Image limit (${MAX_IMAGES}) reached, skipping remaining`);
                break;
            }

            // 解析图片路径
            const resolvedPath = this.resolveImagePath(filePath, imgPath);
            if (!resolvedPath) continue;

            try {
                const imgData = await CanvasConverter.readSingleImageFile(
                    this.app,
                    resolvedPath,
                    settings.imageCompressionQuality,
                    settings.imageMaxSize
                );
                if (imgData) {
                    images.push({
                        base64: imgData.base64,
                        mimeType: imgData.mimeType,
                        type: 'image'
                    });
                }
            } catch (e) {
                console.warn('Notes AI: Failed to read embedded image:', imgPath, e);
            }
        }

        return images;
    }

    /**
     * 解析图片路径（相对于文件所在目录或 vault 根目录）
     */
    private resolveImagePath(filePath: string, imgPath: string): string | null {
        // 先尝试从 vault 根目录查找
        const file = this.app.vault.getAbstractFileByPath(imgPath);
        if (file) {
            return imgPath;
        }

        // 尝试相对于文件所在目录
        const fileDir = filePath.substring(0, filePath.lastIndexOf('/'));
        const relativePath = fileDir ? `${fileDir}/${imgPath}` : imgPath;
        const relativeFile = this.app.vault.getAbstractFileByPath(relativePath);
        if (relativeFile) {
            return relativePath;
        }

        return null;
    }

    /**
     * 处理 Image 模式的图片生成
     */
    private async handleImageGeneration(prompt: string): Promise<void> {
        if (!this.lastContext) {
            new Notice(t('No active file'));
            return;
        }

        const context = this.lastContext;
        const { editor, file, selectedText } = context;

        // 获取 Image Options（使用 Canvas 统一配置）
        const imageOptions = this.editPalette?.getImageOptions() || {
            resolution: this.plugin.settings.defaultResolution || '1K',
            aspectRatio: this.plugin.settings.defaultAspectRatio || '1:1'
        };

        // 创建使用选中 Image 模型的 ApiManager
        const localApiManager = this.createImageApiManager();

        // 构建生成指令
        let instruction = prompt;
        if (!instruction && selectedText) {
            instruction = t('Generate image from context');
        }
        if (!instruction) {
            new Notice(t('Enter instructions'));
            return;
        }

        // 选中文本作为上下文
        const contextText = selectedText || '';

        // 提取选中文本中的内嵌图片作为参考
        const inputImages = await this.extractDocumentImages(contextText, file.path);
        const imagesWithRoles = inputImages.map(img => ({
            base64: img.base64,
            mimeType: img.mimeType,
            role: 'reference'  // 统一标记为参考图
        }));

        if (imagesWithRoles.length > 0) {
            console.debug(`Notes AI Image: Found ${imagesWithRoles.length} reference image(s)`);
        }

        console.debug(`Notes AI Image: Generating with prompt="${instruction}", context="${contextText.substring(0, 50)}..."`);

        // 获取插入位置 - 选区末尾
        const insertPos = editor.getCursor('to');

        // 使用 TaskManager 启动异步任务
        await this.imageTaskManager.startTask(
            editor,
            insertPos,
            instruction,
            contextText,
            imagesWithRoles,
            imageOptions,
            localApiManager,
            file,
            (base64, f) => this.saveImageToVault(base64, f)
        );
    }

    /**
     * 创建使用选中 Image 模型的 ApiManager
     */
    private createImageApiManager(): ApiManager {
        const selectedModel = this.editPalette?.getSelectedImageModel() || '';
        if (!selectedModel) {
            return new ApiManager(this.plugin.settings);
        }

        const [provider, modelId] = selectedModel.split('|');
        if (!provider || !modelId) {
            return new ApiManager(this.plugin.settings);
        }

        const localSettings = { ...this.plugin.settings, apiProvider: provider as ApiProvider };

        if (provider === 'openrouter') {
            localSettings.openRouterImageModel = modelId;
        } else if (provider === 'gemini') {
            localSettings.geminiImageModel = modelId;
        } else if (provider === 'yunwu') {
            localSettings.yunwuImageModel = modelId;
        } else if (provider === 'gptgod') {
            localSettings.gptGodImageModel = modelId;
        }

        return new ApiManager(localSettings);
    }

    /**
     * 保存生成的图片到 vault
     */
    private async saveImageToVault(base64DataUrl: string, currentFile: TFile): Promise<string> {
        const timestamp = Date.now();
        const fileName = `ai-generated-${timestamp}.png`;

        // 保存到与当前文件相同目录
        const folder = currentFile.parent?.path || '';
        const filePath = folder ? `${folder}/${fileName}` : fileName;

        // 转换 base64 并写入
        const base64 = base64DataUrl.replace(/^data:image\/\w+;base64,/, '');
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }

        await this.app.vault.createBinary(filePath, bytes.buffer);
        return fileName;  // 返回相对路径供 ![[]] 使用
    }

    /**
     * 从设置刷新所有配置（供 main.ts 的 notifySettingsChanged 调用）
     */
    public refreshFromSettings(): void {
        this.initFromSettings();
    }

    destroy(): void {
        // 清理事件监听
        document.removeEventListener('selectionchange', this.selectionChangeHandler);
        document.removeEventListener('keydown', this.escapeHandler, true);
        document.removeEventListener('mousedown', this.mousedownHandler, true);

        // 清理 Obsidian 事件
        if (this.leafChangeCleanup) {
            this.app.workspace.offref(this.leafChangeCleanup);
        }

        // 销毁 UI 组件
        this.floatingButton.destroy();
        this.editPalette?.destroy();

        // 销毁任务管理器
        this.imageTaskManager.destroy();
    }
}
