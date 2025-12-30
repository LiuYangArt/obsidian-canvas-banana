/**
 * Notes Selection Handler
 * 监听 Notes 编辑器中的文本选中，管理悬浮按钮和面板的显示
 */

import { App, MarkdownView, Editor, TFile, Notice } from 'obsidian';
import type CanvasAIPlugin from '../../main';
import { NotesFloatingButton } from './notes-floating-button';
import { NotesEditPalette } from './notes-edit-palette';
import { SelectionContext } from '../types';
import { DiffModal } from '../ui/modals';
import { buildEditModeSystemPrompt } from '../prompts/edit-mode-prompt';
import { CanvasConverter } from '../canvas/canvas-converter';
import { handleGlobalUpdate } from './global-update';

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
    
    // 事件清理
    private selectionChangeHandler: () => void;
    private escapeHandler: (evt: KeyboardEvent) => void;
    private mousedownHandler: (evt: MouseEvent) => void;

    constructor(plugin: CanvasAIPlugin) {
        this.plugin = plugin;
        this.app = plugin.app;

        // 创建 UI 组件
        this.floatingButton = new NotesFloatingButton();
        
        // 只有当 apiManager 存在时才创建 editPalette
        if (this.plugin.apiManager) {
            this.editPalette = new NotesEditPalette(this.app, this.plugin.apiManager);
            this.editPalette.setOnGenerate((prompt) => this.handleGeneration(prompt));
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
        
        // 初始化 Presets
        this.editPalette.initPresets(settings.editPresets || []);
        this.editPalette.setOnPresetChange((presets) => {
            this.plugin.settings.editPresets = presets;
            void this.plugin.saveSettings();
        });

        // 初始化 Model 选择
        this.editPalette.initQuickSwitchModels(
            settings.quickSwitchTextModels || [],
            settings.paletteEditModel || ''
        );
        this.editPalette.setOnModelChange((modelKey) => {
            this.plugin.settings.paletteEditModel = modelKey;
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
                    evt.preventDefault();
                    evt.stopPropagation();
                }
            }
        };
        document.addEventListener('keydown', this.escapeHandler, true);

        // 监听点击事件，用于捕获选区和关闭面板
        this.mousedownHandler = (evt: MouseEvent) => {
            const target = evt.target as HTMLElement;
            
            // 点击 Notes AI 界面前，强制捕获选区
            const isPalette = target.closest('.notes-ai-palette');
            const isButton = target.closest('#notes-ai-floating-button');
            
            if (isPalette || isButton) {
                this.captureContext();
            } else {
                // 点击其他地方，隐藏面板
                if (this.editPalette?.visible) {
                    this.editPalette.hide();
                }
            }
        };
        document.addEventListener('mousedown', this.mousedownHandler, true);
    }

    private checkSelection(): void {
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
        // 获取选区结束位置的屏幕坐标
        const toCursor = editor.getCursor('to');
        
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
        for (let i = 0; i < toCursor.line; i++) {
            offset += doc.getLine(i).length + 1; // +1 for newline
        }
        offset += toCursor.ch;

        const coords = cm.coordsAtPos(offset);
        if (coords) {
            // 按钮显示在选区右侧偏下一点
            this.floatingButton.show(coords.left + 10, coords.bottom + 5);
        }
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

        // 获取按钮位置，在按钮右侧显示面板
        const buttonPos = this.floatingButton.getPosition();
        const paletteX = Math.min(buttonPos.x + 10, window.innerWidth - 350);
        const paletteY = Math.max(buttonPos.y - 20, 10);

        // 隐藏按钮，显示面板
        this.floatingButton.hide();
        this.editPalette.show(paletteX, paletteY);
    }

    private async handleGeneration(prompt: string): Promise<void> {
        if (!this.lastContext || !this.plugin.apiManager) {
            return;
        }

        const context = this.lastContext;
        const { editor, selectedText, preText, postText } = context;

        // 保存选区位置（在异步操作前保存）
        const savedFromCursor = editor.getCursor('from');
        const savedToCursor = editor.getCursor('to');

        try {
            // System Prompt for Editing - 固定格式指令 + 用户配置
            const systemPrompt = buildEditModeSystemPrompt(this.plugin.settings.editSystemPrompt);

            // 提取文档中的内嵌图片 ![[image.png]]
            const images = await this.extractDocumentImages(context.fullText, context.file.path);

            // 构建用户消息 - 与 Edit Mode prompt 格式匹配
            const userMessage = `Target text to edit:\n\`\`\`\n${selectedText}\n\`\`\`\n\nInstruction: ${prompt}`;

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
            } catch {
                console.debug('Notes AI: Failed to parse JSON response, using raw text');
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
                    // 应用修改 - 使用保存的选区位置
                    editor.replaceRange(replacementText, savedFromCursor, savedToCursor);

                    // 检测并处理全局实体更新 (如果 API 可用且设置开启)
                    if (this.plugin.apiManager && this.plugin.settings.enableGlobalConsistency !== false) {
                        // 计算选区在全文中的偏移量
                        const doc = editor.getDoc();
                        let fromOffset = 0;
                        for (let i = 0; i < savedFromCursor.line; i++) {
                            fromOffset += doc.getLine(i).length + 1;
                        }
                        fromOffset += savedFromCursor.ch;

                        let toOffset = 0;
                        for (let i = 0; i < savedToCursor.line; i++) {
                            toOffset += doc.getLine(i).length + 1;
                        }
                        toOffset += savedToCursor.ch;

                        void handleGlobalUpdate(
                            this.app,
                            this.plugin.apiManager,
                            context.fullText,
                            selectedText,
                            replacementText,
                            { start: fromOffset, end: toOffset },
                            (newFullText) => {
                                // 应用全局更新 - 替换整个文档
                                editor.setValue(newFullText);
                            }
                        );
                    }
                },
                () => {
                    // 取消
                }
            ).open();

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error('Notes AI: Generation error:', message);
            new Notice(`Notes AI Error: ${message}`);
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

    destroy(): void {
        // 清理事件监听
        document.removeEventListener('selectionchange', this.selectionChangeHandler);
        document.removeEventListener('keydown', this.escapeHandler, true);
        document.removeEventListener('mousedown', this.mousedownHandler, true);

        // 销毁 UI 组件
        this.floatingButton.destroy();
        this.editPalette?.destroy();
    }
}
