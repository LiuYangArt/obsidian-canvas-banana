/**
 * Sidebar CoPilot View
 * Notes AI 侧边栏视图，提供多轮对话、文档编辑和图片生成功能
 */

import { ItemView, WorkspaceLeaf, Notice, setIcon, Scope, Editor } from 'obsidian';
import type CanvasAIPlugin from '../../main';
import { ApiManager } from '../api/api-manager';
import { PromptPreset, QuickSwitchModel, ApiProvider } from '../settings/settings';
import { ConfirmModal, DiffModal } from '../ui/modals';
import { PresetManager } from '../ui/preset-manager';
import { buildEditModeSystemPrompt } from '../prompts/edit-mode-prompt';
import { applyPatches, TextChange } from './text-patcher';
import { t } from '../../lang/helpers';
import { formatProviderName } from '../utils/format-utils';
import { extractDocumentImages } from '../utils/image-utils';
import { NotesSelectionContext } from './notes-selection-handler';

export const VIEW_TYPE_SIDEBAR_COPILOT = 'canvas-ai-sidebar-copilot';

type SidebarMode = 'edit' | 'image';

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
}

export class SideBarCoPilotView extends ItemView {
    private plugin: CanvasAIPlugin;
    private chatHistory: ChatMessage[] = [];
    private currentDocPath: string | null = null;

    // DOM Elements
    private messagesContainer: HTMLElement;
    private inputEl: HTMLTextAreaElement;
    private generateBtn: HTMLButtonElement;
    private footerEl: HTMLElement;
    private notSupportedEl: HTMLElement;

    // Tab & Mode
    private currentMode: SidebarMode = 'edit';
    private editTabBtn: HTMLButtonElement | null = null;
    private imageTabBtn: HTMLButtonElement | null = null;
    private editOptionsEl: HTMLElement | null = null;
    private imageOptionsEl: HTMLElement | null = null;

    // Settings - 使用 Canvas 统一配置
    private presetSelect: HTMLSelectElement;
    private modelSelect: HTMLSelectElement;
    private editPresets: PromptPreset[] = [];
    private imagePresets: PromptPreset[] = [];  // 共用 Canvas imagePresets
    private quickSwitchTextModels: QuickSwitchModel[] = [];
    private quickSwitchImageModels: QuickSwitchModel[] = [];
    private selectedTextModel: string = '';
    private selectedImageModel: string = '';  // 共用 Canvas paletteImageModel

    // Image Options
    private resolutionSelect: HTMLSelectElement | null = null;
    private aspectRatioSelect: HTMLSelectElement | null = null;
    private imageModelSelect: HTMLSelectElement | null = null;

    // State
    private isGenerating: boolean = false;
    private isEditBlocked: boolean = false;
    private isImageBlocked: boolean = false;
    private pendingTaskCount: number = 0;

    // Selection context captured when sidebar receives focus
    private capturedContext: NotesSelectionContext | null = null;

    private onModeChange: ((mode: SidebarMode) => void) | null = null;
    
    private keyScope: Scope;
    private presetManager: PresetManager;

    constructor(leaf: WorkspaceLeaf, plugin: CanvasAIPlugin) {
        super(leaf);
        this.plugin = plugin;

        this.keyScope = new Scope(this.app.scope);
        this.keyScope.register(['Ctrl'], 'Enter', (evt: KeyboardEvent) => {
            evt.preventDefault();
            void this.handleGenerate();
            return false;
        });

        // 初始化 PresetManager
        this.presetManager = new PresetManager(this.app, {
            getPresets: () => this.getCurrentPresets(),
            setPresets: (presets) => this.setCurrentPresets(presets),
            getInputValue: () => this.inputEl?.value || '',
            getSelectValue: () => this.presetSelect?.value || '',
            refreshDropdown: () => this.refreshPresetDropdown(),
            setSelectValue: (id) => { if (this.presetSelect) this.presetSelect.value = id; }
        });
    }

    getViewType(): string {
        return VIEW_TYPE_SIDEBAR_COPILOT;
    }

    getDisplayText(): string {
        return t('Canvas Banana');
    }

    getIcon(): string {
        return 'banana';
    }

    // eslint-disable-next-line @typescript-eslint/require-await
    async onOpen(): Promise<void> {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('sidebar-copilot-container');

        this.createDOM(container);
        this.initFromSettings();
        this.registerActiveFileListener();
    }

    // eslint-disable-next-line @typescript-eslint/require-await
    async onClose(): Promise<void> {
        this.chatHistory = [];
        this.currentDocPath = null;
    }

    private createDOM(container: HTMLElement): void {
        // Header (无 Tab，Tab 移到 Footer)
        const header = container.createDiv('sidebar-copilot-header');
        header.createDiv({ cls: 'sidebar-copilot-title', text: t('Canvas Banana') });

        // Messages Area
        this.messagesContainer = container.createDiv('sidebar-chat-messages');

        // Not Supported Message (hidden by default)
        this.notSupportedEl = container.createDiv('sidebar-not-supported');
        this.notSupportedEl.addClass('is-hidden');
        this.notSupportedEl.createEl('p', {
            cls: 'sidebar-not-supported-text',
            text: t('Notes AI only works with markdown files')
        });

        // Footer (Input Area with Tabs)
        this.footerEl = container.createDiv('sidebar-copilot-footer');

        // Tab 容器 - 复用悬浮面板样式
        const tabsEl = this.footerEl.createDiv('canvas-ai-tabs');
        this.editTabBtn = tabsEl.createEl('button', { cls: 'canvas-ai-tab active', text: t('Edit') });
        this.imageTabBtn = tabsEl.createEl('button', { cls: 'canvas-ai-tab', text: t('Image') });

        // Tab 切换事件 - user triggered
        this.editTabBtn.addEventListener('click', () => this.handleUserSwitchMode('edit'));
        this.imageTabBtn.addEventListener('click', () => this.handleUserSwitchMode('image'));

        // Preset Row - 复用悬浮面板样式
        const presetRow = this.footerEl.createDiv('canvas-ai-preset-row');
        this.presetSelect = presetRow.createEl('select', 'canvas-ai-preset-select dropdown');
        this.presetSelect.createEl('option', { value: '', text: t('Select prompt preset') });

        const presetActions = presetRow.createDiv('canvas-ai-preset-actions');
        const createPresetBtn = (action: string, titleText: string, icon: string) => {
            const btn = presetActions.createEl('button', {
                cls: 'canvas-ai-preset-btn',
                attr: { 'data-action': action, 'title': titleText }
            });
            setIcon(btn, icon);
            return btn;
        };

        const presetAddBtn = createPresetBtn('add', t('New Preset'), 'circle-plus');
        const presetDeleteBtn = createPresetBtn('delete', t('Delete'), 'circle-x');
        const presetSaveBtn = createPresetBtn('save', t('Save'), 'save');
        const presetRenameBtn = createPresetBtn('rename', t('Rename Preset'), 'book-a');

        presetAddBtn.addEventListener('click', () => this.presetManager.handleAdd());
        presetDeleteBtn.addEventListener('click', () => this.presetManager.handleDelete());
        presetSaveBtn.addEventListener('click', () => this.presetManager.handleSave());
        presetRenameBtn.addEventListener('click', () => this.presetManager.handleRename());

        this.presetSelect.addEventListener('change', () => {
            const selectedId = this.presetSelect.value;
            if (selectedId) {
                const presets = this.getCurrentPresets();
                const p = presets.find(x => x.id === selectedId);
                if (p) this.inputEl.value = p.prompt;
            }
        });

        // 点击 select 时，如果已选中某 preset 则重新应用（支持重复选择同一 preset）
        this.presetSelect.addEventListener('click', () => {
            const selectedId = this.presetSelect.value;
            if (selectedId) {
                const presets = this.getCurrentPresets();
                const p = presets.find(x => x.id === selectedId);
                if (p) this.inputEl.value = p.prompt;
            }
        });

        // Input Textarea - 复用悬浮面板样式
        this.inputEl = this.footerEl.createEl('textarea', {
            cls: 'canvas-ai-prompt-input',
            attr: { placeholder: t('Enter instructions'), rows: '3' }
        });

        // Edit Model Selection Row - 复用悬浮面板样式
        this.editOptionsEl = this.footerEl.createDiv('canvas-ai-chat-options');
        const editModelRow = this.editOptionsEl.createDiv('canvas-ai-option-row canvas-ai-model-select-row');
        const editModelGrp = editModelRow.createEl('span', 'canvas-ai-option-group');
        editModelGrp.createEl('label', { text: t('Palette Model') });
        this.modelSelect = editModelGrp.createEl('select', 'dropdown');

        this.modelSelect.addEventListener('change', () => {
            this.selectedTextModel = this.modelSelect.value;
            this.plugin.settings.paletteEditModel = this.selectedTextModel;
            void this.plugin.saveSettings();
        });

        // Image Options Row (hidden by default)
        this.imageOptionsEl = this.footerEl.createDiv('canvas-ai-image-options is-hidden');

        // Resolution & Ratio row
        const imageOptRow1 = this.imageOptionsEl.createDiv('canvas-ai-option-row');

        const resGrp = imageOptRow1.createEl('span', 'canvas-ai-option-group');
        resGrp.createEl('label', { text: t('Resolution') });
        this.resolutionSelect = resGrp.createEl('select', 'dropdown');
        ['1K', '2K', '4K'].forEach(res => {
            this.resolutionSelect!.createEl('option', { value: res, text: res });
        });

        const ratioGrp = imageOptRow1.createEl('span', 'canvas-ai-option-group');
        ratioGrp.createEl('label', { text: t('Ratio') });
        this.aspectRatioSelect = ratioGrp.createEl('select', 'dropdown');
        ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'].forEach(ratio => {
            this.aspectRatioSelect!.createEl('option', { value: ratio, text: ratio });
        });

        // Image Model row - 复用悬浮面板样式
        const imageOptRow2 = this.imageOptionsEl.createDiv('canvas-ai-option-row canvas-ai-model-select-row');
        const imageModelGrp = imageOptRow2.createEl('span', 'canvas-ai-option-group');
        imageModelGrp.createEl('label', { text: t('Palette Model') });
        this.imageModelSelect = imageModelGrp.createEl('select', 'dropdown');

        this.imageModelSelect.addEventListener('change', () => {
            this.selectedImageModel = this.imageModelSelect!.value;
            this.plugin.settings.paletteImageModel = this.selectedImageModel;  // 统一保存
            void this.plugin.saveSettings();
        });

        this.resolutionSelect.addEventListener('change', () => {
            this.plugin.settings.defaultResolution = this.resolutionSelect!.value;  // 统一配置
            void this.plugin.saveSettings();
        });

        this.aspectRatioSelect.addEventListener('change', () => {
            this.plugin.settings.defaultAspectRatio = this.aspectRatioSelect!.value;  // 统一配置
            void this.plugin.saveSettings();
        });

        // Action Row - 复用悬浮面板样式
        const actionRow = this.footerEl.createDiv('canvas-ai-action-row');
        this.generateBtn = actionRow.createEl('button', { cls: 'canvas-ai-generate-btn', text: t('Generate') });
        this.generateBtn.addEventListener('click', () => void this.handleGenerate());

        // Scope 管理：focus 时激活 Ctrl+Enter，blur 时取消
        this.inputEl.addEventListener('focus', () => {
            this.app.keymap.pushScope(this.keyScope);
            // 捕获选区
            this.captureSelectionOnFocus();
        });
        this.inputEl.addEventListener('blur', () => {
            this.app.keymap.popScope(this.keyScope);
        });

        // 阻止键盘事件冒泡（避免 Obsidian 快捷键冲突）
        this.inputEl.addEventListener('keydown', (e) => e.stopPropagation());
        this.inputEl.addEventListener('keyup', (e) => e.stopPropagation());
        this.inputEl.addEventListener('keypress', (e) => e.stopPropagation());
    }

    setOnModeChange(callback: (mode: SidebarMode) => void): void {
        this.onModeChange = callback;
    }

    /**
     * 用户点击切换 Tab
     */
    private handleUserSwitchMode(mode: SidebarMode): void {
        if (this.switchModeInternal(mode)) {
            this.onModeChange?.(mode);
        }
    }

    /**
     * 外部程序切换 Tab
     */
    public setMode(mode: SidebarMode): void {
        this.switchModeInternal(mode);
    }

    private switchModeInternal(mode: SidebarMode): boolean {
        // 如果 Edit 模式被禁用，阻止切换
        if (mode === 'edit' && this.isEditBlocked) {
            new Notice(t('Edit disabled during image generation'));
            return false;
        }

        // 如果 Image 模式被禁用，阻止切换
        if (mode === 'image' && this.isImageBlocked) {
            new Notice(t('Image disabled during edit generation'));
            return false;
        }

        if (this.currentMode === mode) return false;
        this.currentMode = mode;

        // 更新 Tab 状态
        if (this.editTabBtn && this.imageTabBtn) {
            this.editTabBtn.toggleClass('active', mode === 'edit');
            this.imageTabBtn.toggleClass('active', mode === 'image');
        }

        // 更新 options 显示
        if (this.editOptionsEl && this.imageOptionsEl) {
            this.editOptionsEl.toggleClass('is-hidden', mode !== 'edit');
            this.imageOptionsEl.toggleClass('is-hidden', mode !== 'image');
        }

        // 更新 placeholder
        if (mode === 'edit') {
            this.inputEl.placeholder = t('Enter instructions');
        } else {
            this.inputEl.placeholder = t('Describe the image');
        }

        // 刷新 preset dropdown
        this.refreshPresetDropdown();
        return true;
    }

    public setEditBlocked(blocked: boolean): void {
        this.isEditBlocked = blocked;

        if (this.editTabBtn) {
            this.editTabBtn.toggleClass('disabled', blocked);
        }

        // 如果当前是 Edit 模式且刚被禁用，自动切换到 Image - 由 Handler 统一控制
    }

    public setImageBlocked(blocked: boolean): void {
        this.isImageBlocked = blocked;

        if (this.imageTabBtn) {
            this.imageTabBtn.toggleClass('disabled', blocked);
        }

        // 如果当前是 Image 模式且刚被禁用，自动切换到 Edit - 由 Handler 统一控制
    }

    private initFromSettings(): void {
        // 使用 Canvas 统一配置
        this.editPresets = [...(this.plugin.settings.editPresets || [])];
        this.imagePresets = [...(this.plugin.settings.imagePresets || [])];  // 共用 Canvas imagePresets
        this.refreshPresetDropdown();

        // Load quick switch models
        this.quickSwitchTextModels = [...(this.plugin.settings.quickSwitchTextModels || [])];
        this.quickSwitchImageModels = [...(this.plugin.settings.quickSwitchImageModels || [])];
        this.selectedTextModel = this.plugin.settings.paletteEditModel || '';
        this.selectedImageModel = this.plugin.settings.paletteImageModel || '';  // 共用 Canvas paletteImageModel
        this.updateTextModelSelect();
        this.updateImageModelSelect();

        // Load image options（使用 Canvas 统一配置）
        if (this.resolutionSelect) {
            this.resolutionSelect.value = this.plugin.settings.defaultResolution || '1K';
        }
        if (this.aspectRatioSelect) {
            this.aspectRatioSelect.value = this.plugin.settings.defaultAspectRatio || '1:1';
        }
    }

    /**
     * 从设置刷新所有配置（供 main.ts 的 notifySettingsChanged 调用）
     */
    public refreshFromSettings(): void {
        // 刷新 presets
        this.editPresets = [...(this.plugin.settings.editPresets || [])];
        this.imagePresets = [...(this.plugin.settings.imagePresets || [])];
        this.refreshPresetDropdown();

        // 刷新 quick switch models
        this.quickSwitchTextModels = [...(this.plugin.settings.quickSwitchTextModels || [])];
        this.quickSwitchImageModels = [...(this.plugin.settings.quickSwitchImageModels || [])];
        this.selectedTextModel = this.plugin.settings.paletteEditModel || '';
        this.selectedImageModel = this.plugin.settings.paletteImageModel || '';
        this.updateTextModelSelect();
        this.updateImageModelSelect();

        // 刷新 image options
        if (this.resolutionSelect) {
            this.resolutionSelect.value = this.plugin.settings.defaultResolution || '1K';
        }
        if (this.aspectRatioSelect) {
            this.aspectRatioSelect.value = this.plugin.settings.defaultAspectRatio || '1:1';
        }
    }

    private getCurrentPresets(): PromptPreset[] {
        return this.currentMode === 'edit' ? this.editPresets : this.imagePresets;
    }

    private setCurrentPresets(presets: PromptPreset[]): void {
        if (this.currentMode === 'edit') {
            this.editPresets = presets;
            this.plugin.settings.editPresets = presets;
        } else {
            this.imagePresets = presets;
            this.plugin.settings.imagePresets = presets;  // 统一保存到 Canvas imagePresets
        }
        void this.plugin.saveSettings();
    }

    private refreshPresetDropdown(): void {
        this.presetSelect.empty();
        this.presetSelect.createEl('option', { value: '', text: t('Select prompt preset') });
        const presets = this.getCurrentPresets();
        presets.forEach(preset => {
            this.presetSelect.createEl('option', { value: preset.id, text: preset.name });
        });
    }

    private updateTextModelSelect(): void {
        this.modelSelect.empty();

        this.quickSwitchTextModels.forEach(model => {
            const key = `${model.provider}|${model.modelId}`;
            const displayName = `${model.displayName || model.modelId} | ${formatProviderName(model.provider)}`;
            this.modelSelect.createEl('option', { value: key, text: displayName });
        });

        if (this.selectedTextModel && this.modelSelect.querySelector(`option[value="${this.selectedTextModel}"]`)) {
            this.modelSelect.value = this.selectedTextModel;
        } else if (this.quickSwitchTextModels.length > 0) {
            const firstKey = `${this.quickSwitchTextModels[0].provider}|${this.quickSwitchTextModels[0].modelId}`;
            this.modelSelect.value = firstKey;
            this.selectedTextModel = firstKey;
        }
    }

    private updateImageModelSelect(): void {
        if (!this.imageModelSelect) return;
        this.imageModelSelect.empty();

        this.quickSwitchImageModels.forEach(model => {
            const key = `${model.provider}|${model.modelId}`;
            const displayName = `${model.displayName || model.modelId} | ${formatProviderName(model.provider)}`;
            this.imageModelSelect!.createEl('option', { value: key, text: displayName });
        });

        if (this.selectedImageModel && this.imageModelSelect.querySelector(`option[value="${this.selectedImageModel}"]`)) {
            this.imageModelSelect.value = this.selectedImageModel;
        } else if (this.quickSwitchImageModels.length > 0) {
            const firstKey = `${this.quickSwitchImageModels[0].provider}|${this.quickSwitchImageModels[0].modelId}`;
            this.imageModelSelect.value = firstKey;
            this.selectedImageModel = firstKey;
        }
    }

    private registerActiveFileListener(): void {
        // 监听文件切换
        this.registerEvent(
            this.app.workspace.on('file-open', (file) => {
                if (file && file.path !== this.currentDocPath) {
                    this.currentDocPath = file.path;
                    this.clearConversation(true);
                }
                this.updateViewState();
            })
        );

        // 初始化当前文档
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile) {
            this.currentDocPath = activeFile.path;
        }
        this.updateViewState();
    }

    private updateViewState(): void {
        const activeFile = this.app.workspace.getActiveFile();
        const isMarkdown = activeFile && activeFile.extension === 'md';

        if (isMarkdown) {
            this.footerEl.removeClass('is-hidden');
            this.messagesContainer.removeClass('is-hidden');
            this.notSupportedEl.addClass('is-hidden');
        } else {
            this.footerEl.addClass('is-hidden');
            this.messagesContainer.addClass('is-hidden');
            this.notSupportedEl.removeClass('is-hidden');
        }
    }

    private clearConversation(silent: boolean = false): void {
        this.chatHistory = [];
        this.messagesContainer.empty();
        if (!silent) {
            new Notice(t('Conversation cleared'));
        }
    }

    private addMessage(role: 'user' | 'assistant', content: string): void {
        const msg: ChatMessage = { role, content, timestamp: Date.now() };
        this.chatHistory.push(msg);

        // 限制对话轮数
        const maxTurns = this.plugin.settings.maxConversationTurns || 5;
        while (this.chatHistory.length > maxTurns * 2) {
            this.chatHistory.shift();
        }

        this.renderMessage(msg);
    }

    private renderMessage(msg: ChatMessage): void {
        const msgEl = this.messagesContainer.createDiv(`sidebar-chat-message ${msg.role}`);
        const roleLabel = msg.role === 'user' ? 'You' : 'AI';
        msgEl.createEl('span', { cls: 'sidebar-message-role', text: roleLabel });
        msgEl.createEl('div', { cls: 'sidebar-message-content', text: msg.content });
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }

    private async handleGenerate(): Promise<void> {
        if (this.currentMode === 'image') {
            return this.handleImageGenerate();
        }
        return this.handleEditGenerate();
    }

    private async handleEditGenerate(): Promise<void> {
        const prompt = this.inputEl.value.trim();
        if (!prompt) {
            new Notice(t('Enter instructions'));
            return;
        }

        if (this.isGenerating) {
            new Notice(t('Generation in progress'));
            return;
        }

        // 获取当前文档
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension !== 'md') {
            new Notice(t('No active file'));
            return;
        }

        const file = activeFile;
        const docContent = await this.app.vault.read(file);

        // 从 handler 获取最新的选区上下文（在 mousedown 阶段捕获）
        const notesHandler = this.plugin.getNotesHandler();
        if (notesHandler) {
            const latestContext = notesHandler.getLastContext();
            if (latestContext) {
                this.capturedContext = latestContext;
            }
        }

        // 判断是否使用选区模式
        const context = this.capturedContext;
        const hasSelection = context && context.selectedText && context.selectedText.trim().length > 0;

        // 添加用户消息
        this.addMessage('user', prompt);
        this.inputEl.value = '';

        // 更新 UI 状态
        this.isGenerating = true;
        this.generateBtn.textContent = t('Generating');
        this.generateBtn.addClass('generating');

        // 禁用 Image Tab
        this.setImageBlocked(true);

        // 同步悬浮图标状态（复用上面声明的 notesHandler）
        notesHandler?.setFloatingButtonGenerating(true);
        // 点击生成时立即清除选区高亮（与悬浮按钮行为一致）
        notesHandler?.clearHighlightForSidebar();

        try {
            // 创建 ApiManager
            const localApiManager = this.createLocalApiManager('text');

            // 构建系统提示
            const systemPrompt = buildEditModeSystemPrompt(this.plugin.settings.editSystemPrompt);

            // 根据是否有选区，构建不同的 userMsg
            let userMsg: string;
            let images: { base64: string; mimeType: string; type: 'image' | 'pdf' }[] = [];

            if (hasSelection) {
                // 选区模式：只编辑选中的文本
                userMsg = `Target Text:\n${context.selectedText}\n\nInstruction:\n${prompt}`;
                // 提取选区中的图片
                const extractedImages = await extractDocumentImages(this.app, context.selectedText, file.path, this.plugin.settings);
                images = extractedImages.map(img => ({ ...img, type: 'image' as const }));
            } else {
                // 全文档模式
                userMsg = `Document content:\n${docContent}\n\nInstruction:\n${prompt}`;
                const extractedImages = await extractDocumentImages(this.app, docContent, file.path, this.plugin.settings);
                images = extractedImages.map(img => ({ ...img, type: 'image' as const }));
            }

            // 添加对话历史上下文
            if (this.chatHistory.length > 2) {
                const historyContext = this.chatHistory.slice(0, -1).map(m =>
                    `${m.role === 'user' ? 'User' : 'AI'}: ${m.content}`
                ).join('\n');
                userMsg = `Previous conversation:\n${historyContext}\n\n${userMsg}`;
            }

            // 使用 multimodalChat 或 chatCompletion
            let response: string;
            if (images.length > 0) {
                console.debug(`Sidebar CoPilot: Sending request with ${images.length} images as context`);
                response = await localApiManager.multimodalChat(
                    userMsg,
                    images,
                    systemPrompt,
                    0.5
                );
            } else {
                response = await localApiManager.chatCompletion(userMsg, systemPrompt, 0.5);
            }

            // 解析响应
            let summary = '';
            let replacementText = '';
            let globalChanges: TextChange[] = [];

            try {
                const jsonMatch = response.match(/\{[\s\S]*\}/);
                const jsonStr = jsonMatch ? jsonMatch[0] : response;
                const parsed = JSON.parse(jsonStr);
                replacementText = parsed.replacement || '';
                globalChanges = parsed.globalChanges || [];

                if (parsed.summary) {
                    summary = parsed.summary;
                } else if (globalChanges.length > 0) {
                    summary = t('Applied changes with global updates', { count: globalChanges.length.toString() });
                } else if (replacementText) {
                    summary = t('Text replaced');
                } else {
                    summary = t('No changes needed');
                }
            } catch {
                summary = response.substring(0, 200) + (response.length > 200 ? '...' : '');
            }

            // 添加 AI 回复
            this.addMessage('assistant', summary);

            // 如果有具体修改，使用 patch 方式应用
            if (globalChanges.length > 0) {
                const changesSummary = globalChanges.map((c, i) =>
                    `${i + 1}. "${c.original.substring(0, 30)}${c.original.length > 30 ? '...' : ''}" → "${c.new.substring(0, 30)}${c.new.length > 30 ? '...' : ''}"`
                ).join('\n');

                new ConfirmModal(
                    this.app,
                    `${t('Apply')} ${globalChanges.length} ${t('changes')}?\n\n${changesSummary}`,
                    () => {
                        void (async () => {
                            const patchResult = applyPatches(docContent, globalChanges);
                            if (patchResult.text !== docContent) {
                                await this.app.vault.modify(file, patchResult.text);
                                new Notice(t('File updated'));
                            }
                        })();
                    }
                ).open();
            } else if (replacementText) {
                // 根据是否有选区决定如何替换
                let originalText: string;
                let proposedText: string;

                if (hasSelection && context) {
                    // 选区模式：只替换选中的部分
                    originalText = context.selectedText;
                    proposedText = context.preText + replacementText + context.postText;
                } else {
                    // 全文档模式
                    originalText = docContent;
                    proposedText = replacementText;
                }

                if (proposedText !== docContent) {
                    const diffContext = {
                        nodeId: '',
                        selectedText: originalText,
                        preText: hasSelection && context ? context.preText : '',
                        postText: hasSelection && context ? context.postText : '',
                        fullText: docContent,
                        fileNode: file
                    };

                    new DiffModal(
                        this.app,
                        diffContext,
                        replacementText,
                        async () => {
                            await this.app.vault.modify(file, proposedText);
                            new Notice(t('File updated'));
                            // Diff 确认后选中新生成的文本
                            if (hasSelection && context?.editor) {
                                const newEndOffset = context.preText.length + replacementText.length;
                                this.selectTextRange(context.editor, context.preText.length, newEndOffset);
                            }
                        },
                        () => {
                            // 取消
                        }
                    ).open();
                }
            }

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.addMessage('assistant', `Error: ${errorMsg}`);
            console.error('Sidebar CoPilot Error:', error);
        } finally {
            this.isGenerating = false;
            this.generateBtn.textContent = t('Generate');
            this.generateBtn.removeClass('generating');
            // 恢复 Image Tab
            this.setImageBlocked(false);
            // 恢复悬浮图标状态并清除高亮
            const notesHandler = this.plugin.getNotesHandler();
            notesHandler?.setFloatingButtonGenerating(false);
            this.clearCapturedContext();
        }
    }

    private async handleImageGenerate(): Promise<void> {
        const prompt = this.inputEl.value.trim();

        // 获取当前文档
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension !== 'md') {
            new Notice(t('No active file'));
            return;
        }

        // 从 handler 获取最新的选区上下文（在 mousedown 阶段捕获）
        const notesHandler = this.plugin.getNotesHandler();
        if (!notesHandler) {
            new Notice(t('Services not initialized'));
            return;
        }
        
        // 尝试更新 context
        const latestContext = notesHandler.getLastContext();
        if (latestContext) {
            this.capturedContext = latestContext;
        }

        // 判断是否使用选区模式
        const context = this.capturedContext;
        const hasSelection = context && context.selectedText && context.selectedText.trim().length > 0;

        // Image mode 允许空 prompt，使用选区或默认文案
        const instruction = prompt || (hasSelection ? context.selectedText : t('Generate image from context'));

        // 添加用户消息
        this.addMessage('user', instruction);
        this.inputEl.value = '';

        // 更新状态：增加任务计数并更新按钮
        this.pendingTaskCount++;
        this.updateGenerateButtonState();
        
        try {
            // 委托给 NotesSelectionHandler 处理
            // 使用 void 不等待 Promise，实现"后台任务"效果
            notesHandler.handleImageGeneration(instruction, context)
                .catch(err => {
                    const msg = err instanceof Error ? err.message : String(err);
                    console.error('Sidebar Image Error:', err);
                    this.addMessage('assistant', `Error: ${msg}`);
                })
                .finally(() => {
                    // 任务结束（无论成功失败），减少计数并更新按钮
                    this.pendingTaskCount = Math.max(0, this.pendingTaskCount - 1);
                    this.updateGenerateButtonState();
                });

            // 立即反馈任务已开始
            this.addMessage('assistant', t('Generating image based on your request'));

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.addMessage('assistant', `Error: ${errorMsg}`);
            console.error('Sidebar CoPilot Error:', error);
            
            // 发生同步错误时立即恢复
            this.pendingTaskCount = Math.max(0, this.pendingTaskCount - 1);
            this.updateGenerateButtonState();
        }
    }

    /**
     * 更新生成按钮状态 (复用 FloatingPalette 的样式和逻辑)
     */
    private updateGenerateButtonState(): void {
        const generateBtn = this.generateBtn;
        if (!generateBtn) return;

        if (this.pendingTaskCount === 0) {
            generateBtn.textContent = t('Generate');
            generateBtn.removeClass('generating');
        } else {
            generateBtn.textContent = `${t('Generating')} ${this.pendingTaskCount} ${t('Tasks')}`;
            generateBtn.addClass('generating');
        }

        // 按钮禁用逻辑
        // Image 模式允许并发，不禁用按钮 (除非 explicit logic requirement)
        // Edit 模式通常还要检查 isGenerating，但这里主要处理 Image Mode 的并发反馈
        // 如果需要完全一致，可以加上空 prompt 检查等，但这里主要关注 generating 状态
        
        generateBtn.disabled = false;
    }



    private createLocalApiManager(type: 'text' | 'image'): ApiManager {
        const selectedModel = type === 'text' ? this.selectedTextModel : this.selectedImageModel;
        if (!selectedModel) {
            return new ApiManager(this.plugin.settings);
        }

        const [provider, modelId] = selectedModel.split('|');
        if (!provider || !modelId) {
            return new ApiManager(this.plugin.settings);
        }

        const localSettings = { ...this.plugin.settings, apiProvider: provider as ApiProvider };

        if (type === 'text') {
            if (provider === 'openrouter') {
                localSettings.openRouterTextModel = modelId;
            } else if (provider === 'gemini') {
                localSettings.geminiTextModel = modelId;
            } else if (provider === 'yunwu') {
                localSettings.yunwuTextModel = modelId;
            } else if (provider === 'gptgod') {
                localSettings.gptGodTextModel = modelId;
            }
        } else {
            if (provider === 'openrouter') {
                localSettings.openRouterImageModel = modelId;
            } else if (provider === 'gemini') {
                localSettings.geminiImageModel = modelId;
            } else if (provider === 'yunwu') {
                localSettings.yunwuImageModel = modelId;
            } else if (provider === 'gptgod') {
                localSettings.gptGodImageModel = modelId;
            }
        }

        return new ApiManager(localSettings);
    }

    // saveImageToVault - 已移至 src/utils/image-utils.ts

    // Preset Management - 已移至 PresetManager

    /**
     * 添加外部消息到对话历史（供悬浮面板调用）
     */
    public addExternalMessage(role: 'user' | 'assistant', content: string): void {
        this.addMessage(role, content);
    }

    /**
     * 更新最后一条 AI 消息的内容
     */
    public updateLastAssistantMessage(content: string): void {
        if (this.chatHistory.length === 0) return;

        const lastMsg = this.chatHistory[this.chatHistory.length - 1];
        if (lastMsg.role === 'assistant') {
            lastMsg.content = content;

            // 更新 DOM
            const lastMsgEl = this.messagesContainer.lastElementChild;
            if (lastMsgEl) {
                const contentEl = lastMsgEl.querySelector('.sidebar-message-content');
                if (contentEl) {
                    contentEl.textContent = content;
                }
            }
        }
    }

    // extractDocumentImages, resolveImagePath - 已移至 src/utils/image-utils.ts

    /**
     * 点击侧栏输入框时获取选区上下文
     * 注意：实际选区捕获在 mousedown 阶段完成（由 notes-selection-handler 处理）
     * 这里只是获取已捕获的上下文
     */
    private captureSelectionOnFocus(): void {
        const notesHandler = this.plugin.getNotesHandler();
        if (notesHandler) {
            // 获取在 mousedown 阶段已捕获的上下文（由 notes-selection-handler 处理）
            const context = notesHandler.getLastContext();
            if (context) {
                this.capturedContext = context;
                console.debug('Sidebar CoPilot: Using captured selection context', context.selectedText.substring(0, 50));
            }
        }
    }

    /**
     * 清除捕获的选区和高亮
     */
    private clearCapturedContext(): void {
        this.capturedContext = null;
        const notesHandler = this.plugin.getNotesHandler();
        if (notesHandler) {
            notesHandler.clearHighlightForSidebar();
        }
    }

    /**
     * 在编辑器中选中指定范围的文本
     */
    private selectTextRange(editor: Editor, startOffset: number, endOffset: number): void {
        // 使用 handler 的统一方法选中文字
        const notesHandler = this.plugin.getNotesHandler();
        if (notesHandler) {
            const startPos = editor.offsetToPos(startOffset);
            const endPos = editor.offsetToPos(endOffset);
            notesHandler.selectGeneratedText(editor, startPos, endPos);
        }
    }
}
