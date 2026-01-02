/**
 * Notes Selection Handler
 * 监听 Notes 编辑器中的文本选中，管理悬浮按钮和面板的显示
 */

import { App, MarkdownView, Editor, TFile, Notice, EventRef, EditorPosition } from 'obsidian';
import type CanvasAIPlugin from '../../main';
import { NotesFloatingButton } from './notes-floating-button';
import { NotesEditPalette, NotesPaletteMode } from './notes-edit-palette';
import { SelectionContext } from '../types';
import { DiffModal } from '../ui/modals';
import { buildEditModeSystemPrompt } from '../prompts/edit-mode-prompt';
import { extractDocumentImages, saveImageToVault } from '../utils/image-utils';
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
    private currentMode: NotesPaletteMode = 'edit';

    // 选区高亮容器
    private highlightContainer: HTMLElement | null = null;

    // 侧栏是否已捕获选区上下文（用于保护高亮在视图切换时不被清除）
    private hasSidebarCapturedContext: boolean = false;

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
            this.editPalette.setOnClose(() => {
                this.clearSelectionHighlight();
                // Restore floating button if generating
                if (this.isGenerating || this.imageTaskManager.getActiveTaskCount() > 0) {
                    const btn = this.floatingButton.getElement();
                    // Keep original position or fallback
                    const left = parseInt(btn.style.left) || 100;
                    const top = parseInt(btn.style.top) || 100;
                    this.floatingButton.show(left, top);
                }
            });
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
        
        // 监听 Palette 模式切换
        this.editPalette.setOnModeChange((mode) => {
            this.setMode(mode, 'palette');
        });
    }

    /**
     * 设置当前模式并同步到所有视图
     * @param mode 新模式
     * @param source 来源 ('palette' | 'sidebar' | 'internal')
     */
    private setMode(mode: NotesPaletteMode, source: 'palette' | 'sidebar' | 'internal' = 'internal'): void {
        if (this.currentMode === mode) return; // 避免重复更新
        
        this.currentMode = mode;
        
        // 同步到 Palette (如果不是来源)
        if (source !== 'palette' && this.editPalette) {
            this.editPalette.setMode(mode);
        }
        
        // 同步到 Sidebar (如果不是来源)
        const sidebar = this.getSidebarView();
        if (source !== 'sidebar' && sidebar) {
            sidebar.setMode(mode);
        }
    }
    
    /**
     * 设置 Edit 禁用状态并同步
     */
    private setEditBlocked(blocked: boolean): void {
        this.editPalette?.setEditBlocked(blocked);
        const sidebar = this.getSidebarView();
        if (sidebar) sidebar.setEditBlocked(blocked);
        
        // 如果当前是 Edit 模式且刚被禁用，自动切换到 Image
        if (blocked && this.currentMode === 'edit') {
            this.setMode('image', 'internal');
        }
    }
    
    /**
     * 设置 Image 禁用状态并同步
     */
    private setImageBlocked(blocked: boolean): void {
        this.editPalette?.setImageBlocked(blocked);
        const sidebar = this.getSidebarView();
        if (sidebar) sidebar.setImageBlocked(blocked);
        
        // 如果当前是 Image 模式且刚被禁用，自动切换到 Edit
        if (blocked && this.currentMode === 'image') {
            this.setMode('edit', 'internal');
        }
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
            const isSidebar = target.closest('.sidebar-copilot-container');

            if (isButton) {
                // 只在点击按钮且面板未打开时捕获选区
                if (!this.editPalette?.visible) {
                    this.captureContext();
                }
            } else if (isSidebar) {
                // 点击侧栏时在 mousedown 阶段捕获选区（此时焦点还在编辑器，能获取选区）
                // 注意：必须在焦点转移前捕获，否则 window.getSelection() 会失效
                console.debug('[Sidebar Debug] mousedown on sidebar, target:', target.tagName, target.className);
                this.captureSelectionForSidebar();
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
            // 如果侧栏已捕获选区，保护高亮不被清除
            if (this.hasSidebarCapturedContext) return;

            const view = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (!view) {
                // 切换到非 Markdown 视图，清理所有 UI
                this.floatingButton.hide();
                this.editPalette?.hide();
                this.clearSelectionHighlight();
            }
            
            // 每次视图切换，重新绑定 sidebar 监听 (如果 sidebar 存在)
            this.bindSidebarListeners();
        });
        
        // 初始化绑定
        this.bindSidebarListeners();
    }

    private bindSidebarListeners(): void {
        const sidebar = this.getSidebarView();
        if (sidebar) {
            // 监听 Sidebar 模式切换
            sidebar.setOnModeChange((mode) => {
                this.setMode(mode, 'sidebar');
            });
            // 同步当前状态到 Sidebar (例如刚打开 Sidebar)
            sidebar.setMode(this.currentMode);
        }
    }

    private checkSelection(): void {
        // 面板打开时，不响应选区变化
        if (this.editPalette?.visible) {
            return;
        }

        // 如果正在生成中，我们也允许移动按钮跟随新的选区（类似 Image 模式）
        // 所以移除此之外的 isGenerating 检查

        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view || view.getMode() !== 'source') {
            // 不在 Source Mode (Live Preview 或 Reading Mode)
            // 切换视图隐藏
            this.floatingButton.hide();
            return;
        }

        const editor = view.editor;
        const selection = editor.getSelection();

        if (!selection || selection.trim().length === 0) {
            // 没有选中文本
            // 如果有生图任务或编辑任务进行中，不要隐藏按钮
            if (this.imageTaskManager.getActiveTaskCount() > 0 || this.isGenerating) {
                return;
            }
            this.floatingButton.hide();
            return;
        }

        // 有选中文本，显示悬浮按钮（更新位置）
        this.showButtonNearSelection(editor);
    }

    private showButtonNearSelection(editor: Editor): void {
        // 如果悬浮图标被禁用，直接返回
        if (!this.plugin.settings.noteFloatingIconEnabled) {
            return;
        }

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
        // 追踪清除调用栈
        if (this.highlightContainer) {
            console.debug('[Sidebar Debug] clearSelectionHighlight called, stack:', new Error().stack);
        }
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
        console.debug('[Sidebar Debug] captureSelectionHighlight: selection =', selection?.toString().substring(0, 50), 'rangeCount =', selection?.rangeCount, 'isCollapsed =', selection?.isCollapsed);
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;

        const range = selection.getRangeAt(0);
        const rects = range.getClientRects();
        if (rects.length === 0) return;

        // 通过 selection 的 anchorNode 找到包含它的 .cm-scroller
        // 不能使用 getActiveViewOfType，因为点击侧栏时活动视图会变化
        const anchorNode = selection.anchorNode;
        if (!anchorNode) return;

        const anchorEl = anchorNode.nodeType === Node.ELEMENT_NODE 
            ? anchorNode as HTMLElement 
            : anchorNode.parentElement;
        const scrollerEl = anchorEl?.closest('.cm-scroller');
        
        console.debug('[Sidebar Debug] captureSelectionHighlight: scrollerEl =', scrollerEl ? 'found' : 'null');
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
        console.debug('[Sidebar Debug] captureSelectionHighlight: highlight created with', this.highlightContainer.children.length, 'rects');
    }

    /**
     * Flash highlight the provided range and fade out
     */
    /**
     * Select the generated text after a short delay
     */
    private selectGeneratedText(editor: Editor, startPos: EditorPosition, endPos: EditorPosition): void {
        // Ensure editor has focus first
        editor.focus();

        // Delay to allow Modal to close and focus to settle
        setTimeout(() => {
            // Set editor selection
            editor.setSelection(startPos, endPos);
            editor.focus();
        }, 100);
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
        // 如果没有上下文，且没有正在进行的图片任务，尝试捕获
        const hasActiveTasks = this.imageTaskManager.getActiveTaskCount() > 0;
        if (!this.lastContext && !hasActiveTasks) {
            this.captureContext();
        }

        // 如果既没有上下文，也没有活跃任务，则不显示
        if ((!this.lastContext && !hasActiveTasks) || !this.editPalette) {
            return;
        }

        // 标记编辑器容器，让 CSS 保持选区样式
        // 只有当还有选区时才标记
        if (this.lastContext) {
            const view = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (view) {
                view.containerEl.addClass('notes-ai-selection-active');
            }
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

        // 禁用 Image Tab (同步)
        this.setImageBlocked(true);

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

            // 从选中文本提取内嵌图片 ![[image.png]] 作为上下文
            // 注意：只从选中文本提取图片，而非全文档，避免发送过多图片
            const images = await extractDocumentImages(this.app, selectedText, context.file.path, this.plugin.settings);

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
                    // 计算新光标位置
                    const startOffset = editor.posToOffset(savedFromCursor);
                    editor.replaceRange(replacementText, savedFromCursor, savedToCursor);
                    
                    // 触发选区选中
                    const newEndOffset = startOffset + replacementText.length;
                    const newEndCursor = editor.offsetToPos(newEndOffset);
                    this.selectGeneratedText(editor, savedFromCursor, newEndCursor);

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
            // 恢复 Image Tab (同步)
            this.setImageBlocked(false);
        }
    }

    // extractDocumentImages - 已移至 src/utils/image-utils.ts

    // resolveImagePath - 已移至 src/utils/image-utils.ts

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
        const inputImages = await extractDocumentImages(this.app, contextText, file.path, this.plugin.settings);
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

        // 显示生成状态 - 悬浮按钮变绿色动态效果
        this.floatingButton.setGenerating(true);
        const btnPos = this.floatingButton.getPosition();
        this.floatingButton.show(
            parseInt(this.floatingButton.getElement().style.left) || btnPos.x,
            parseInt(this.floatingButton.getElement().style.top) || btnPos.y
        );

        // 禁用 Edit Tab (同步)
        this.setEditBlocked(true);

        try {
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
                (base64, f) => saveImageToVault(this.app.vault, base64, f)
            );
        } finally {
            // 检查是否还有其他图片任务进行中
            if (this.imageTaskManager.getActiveTaskCount() === 0) {
                this.floatingButton.setGenerating(false);
                this.floatingButton.hide();
            }
            
            // 更新 Edit Tab 禁用状态 (同步)
            this.setEditBlocked(this.imageTaskManager.isEditBlocked());
        }
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

    // saveImageToVault - 已移至 src/utils/image-utils.ts

    /**
     * 供侧栏调用：捕获当前选区并创建高亮
     * @returns 选区上下文，如果没有选区则返回 null
     */
    public captureSelectionForSidebar(): NotesSelectionContext | null {
        // 使用 window.getSelection() 获取 DOM 选区
        const domSelection = window.getSelection();
        if (!domSelection || domSelection.rangeCount === 0 || domSelection.isCollapsed) {
            console.debug('[Sidebar Debug] captureSelectionForSidebar: no DOM selection');
            return null;
        }

        // 从选区的 anchorNode 找到包含它的编辑器容器
        const anchorNode = domSelection.anchorNode;
        if (!anchorNode) {
            console.debug('[Sidebar Debug] captureSelectionForSidebar: no anchorNode');
            return null;
        }

        // 找到包含选区的 .workspace-leaf 容器
        const leafEl = (anchorNode.nodeType === Node.ELEMENT_NODE 
            ? anchorNode as HTMLElement 
            : anchorNode.parentElement
        )?.closest('.workspace-leaf');
        
        if (!leafEl) {
            console.debug('[Sidebar Debug] captureSelectionForSidebar: no workspace-leaf found');
            return null;
        }

        // 遍历所有 leaf 找到匹配的 MarkdownView
        const allLeaves = this.app.workspace.getLeavesOfType('markdown');
        let targetView: MarkdownView | null = null;
        
        for (const leaf of allLeaves) {
            // containerEl 在 Obsidian API 中存在但类型定义可能不完整
            const leafContainer = (leaf as unknown as { containerEl: HTMLElement }).containerEl;
            if (leafContainer === leafEl || leafContainer.contains(leafEl)) {
                targetView = leaf.view as MarkdownView;
                break;
            }
        }

        if (!targetView || !targetView.file) {
            console.debug('[Sidebar Debug] captureSelectionForSidebar: no matching MarkdownView found');
            return null;
        }

        console.debug('[Sidebar Debug] captureSelectionForSidebar: found view for', targetView.file.path);

        const editor = targetView.editor;
        const selection = editor.getSelection();
        console.debug('[Sidebar Debug] captureSelectionForSidebar: selection =', selection?.substring(0, 50));

        if (!selection || selection.trim().length === 0) {
            console.debug('[Sidebar Debug] captureSelectionForSidebar: EARLY RETURN - no editor selection');
            return null;
        }

        // 捕获选区高亮
        this.captureSelectionHighlight();
        // 设置侧栏捕获标志，保护高亮不被 active-leaf-change 清除
        this.hasSidebarCapturedContext = true;

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
            nodeId: targetView.file.path,
            selectedText: selection,
            preText: fullText.substring(0, fromOffset),
            postText: fullText.substring(toOffset),
            fullText: fullText,
            isExplicit: true,
            editor: editor,
            file: targetView.file
        };

        return this.lastContext;
    }

    /**
     * 供侧栏调用：清除选区高亮
     */
    public clearHighlightForSidebar(): void {
        this.clearSelectionHighlight();
        // 重置侧栏捕获标志
        this.hasSidebarCapturedContext = false;
    }

    /**
     * 供侧栏调用：设置悬浮图标的生成状态
     */
    public setFloatingButtonGenerating(generating: boolean): void {
        this.floatingButton.setGenerating(generating);
        if (generating && this.plugin.settings.noteFloatingIconEnabled) {
            // 如果需要显示悬浮图标，显示在最后已知位置
            const btn = this.floatingButton.getElement();
            const left = parseInt(btn.style.left) || 100;
            const top = parseInt(btn.style.top) || 100;
            this.floatingButton.show(left, top);
        } else if (!generating) {
            this.floatingButton.hide();
        }
    }

    /**
     * 供侧栏调用：获取当前缓存的选区上下文
     */
    public getLastContext(): NotesSelectionContext | null {
        return this.lastContext;
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
