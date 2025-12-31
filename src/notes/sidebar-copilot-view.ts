/**
 * Sidebar CoPilot View
 * Notes AI 侧边栏视图，提供多轮对话和文档编辑功能
 */

import { ItemView, WorkspaceLeaf, Notice, setIcon, Scope } from 'obsidian';
import type CanvasAIPlugin from '../../main';
import { ApiManager } from '../api/api-manager';
import { PromptPreset, QuickSwitchModel, ApiProvider } from '../settings/settings';
import { InputModal, ConfirmModal, DiffModal } from '../ui/modals';
import { buildEditModeSystemPrompt } from '../prompts/edit-mode-prompt';
import { applyPatches, TextChange } from './text-patcher';
import { t } from '../../lang/helpers';
import { formatProviderName } from '../utils/format-utils';
import { CanvasConverter } from '../canvas/canvas-converter';

export const VIEW_TYPE_SIDEBAR_COPILOT = 'canvas-ai-sidebar-copilot';

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

    // Settings
    private presetSelect: HTMLSelectElement;
    private modelSelect: HTMLSelectElement;
    private editPresets: PromptPreset[] = [];
    private quickSwitchModels: QuickSwitchModel[] = [];
    private selectedModel: string = '';

    // State
    private isGenerating: boolean = false;
    private keyScope: Scope;

    constructor(leaf: WorkspaceLeaf, plugin: CanvasAIPlugin) {
        super(leaf);
        this.plugin = plugin;
        
        // 创建 Scope 用于注册 Ctrl+Enter
        this.keyScope = new Scope(this.app.scope);
        this.keyScope.register(['Ctrl'], 'Enter', (evt: KeyboardEvent) => {
            evt.preventDefault();
            void this.handleGenerate();
            return false;
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
        // Header
        const header = container.createDiv('sidebar-copilot-header');
        header.createEl('span', { cls: 'sidebar-copilot-title', text: t('Canvas Banana') });

        // Messages Area
        this.messagesContainer = container.createDiv('sidebar-chat-messages');

        // Not Supported Message (hidden by default)
        this.notSupportedEl = container.createDiv('sidebar-not-supported');
        this.notSupportedEl.addClass('is-hidden');
        this.notSupportedEl.createEl('p', {
            cls: 'sidebar-not-supported-text',
            text: t('Notes AI only works with markdown files')
        });

        // Footer (Input Area)
        this.footerEl = container.createDiv('sidebar-copilot-footer');

        // Preset Row
        const presetRow = this.footerEl.createDiv('sidebar-preset-row');
        this.presetSelect = presetRow.createEl('select', 'sidebar-preset-select dropdown');
        this.presetSelect.createEl('option', { value: '', text: t('Select prompt preset') });

        const presetActions = presetRow.createDiv('sidebar-preset-actions');
        const createPresetBtn = (action: string, titleText: string, icon: string) => {
            const btn = presetActions.createEl('button', {
                cls: 'sidebar-preset-btn',
                attr: { 'data-action': action, 'title': titleText }
            });
            setIcon(btn, icon);
            return btn;
        };

        const presetAddBtn = createPresetBtn('add', t('New Preset'), 'circle-plus');
        const presetDeleteBtn = createPresetBtn('delete', t('Delete'), 'circle-x');
        const presetSaveBtn = createPresetBtn('save', t('Save'), 'save');
        const presetRenameBtn = createPresetBtn('rename', t('Rename Preset'), 'book-a');

        // Bind preset actions
        presetAddBtn.addEventListener('click', () => this.handlePresetAdd());
        presetDeleteBtn.addEventListener('click', () => this.handlePresetDelete());
        presetSaveBtn.addEventListener('click', () => this.handlePresetSave());
        presetRenameBtn.addEventListener('click', () => this.handlePresetRename());

        this.presetSelect.addEventListener('change', () => {
            const selectedId = this.presetSelect.value;
            if (selectedId) {
                const p = this.editPresets.find(x => x.id === selectedId);
                if (p) this.inputEl.value = p.prompt;
            }
        });

        // Input Textarea
        this.inputEl = this.footerEl.createEl('textarea', {
            cls: 'sidebar-prompt-input',
            attr: { placeholder: t('Enter instructions'), rows: '3' }
        });

        // Model Selection Row
        const modelRow = this.footerEl.createDiv('sidebar-model-row');
        const modelGrp = modelRow.createEl('span', 'sidebar-model-group');
        modelGrp.createEl('label', { text: t('Palette Model') });
        this.modelSelect = modelGrp.createEl('select', 'sidebar-model-select dropdown');

        this.modelSelect.addEventListener('change', () => {
            this.selectedModel = this.modelSelect.value;
            // Save to settings
            this.plugin.settings.paletteEditModel = this.selectedModel;
            void this.plugin.saveSettings();
        });

        // Action Row
        const actionRow = this.footerEl.createDiv('sidebar-action-row');
        this.generateBtn = actionRow.createEl('button', { cls: 'sidebar-generate-btn', text: t('Generate') });
        this.generateBtn.addEventListener('click', () => void this.handleGenerate());

        // Scope 管理：focus 时激活 Ctrl+Enter，blur 时取消
        this.inputEl.addEventListener('focus', () => {
            this.app.keymap.pushScope(this.keyScope);
        });
        this.inputEl.addEventListener('blur', () => {
            this.app.keymap.popScope(this.keyScope);
        });

        // 阻止键盘事件冒泡（避免 Obsidian 快捷键冲突）
        this.inputEl.addEventListener('keydown', (e) => e.stopPropagation());
        this.inputEl.addEventListener('keyup', (e) => e.stopPropagation());
        this.inputEl.addEventListener('keypress', (e) => e.stopPropagation());
    }

    private initFromSettings(): void {
        // Load presets
        this.editPresets = [...(this.plugin.settings.editPresets || [])];
        this.refreshPresetDropdown();

        // Load quick switch models
        this.quickSwitchModels = [...(this.plugin.settings.quickSwitchTextModels || [])];
        this.selectedModel = this.plugin.settings.paletteEditModel || '';
        this.updateModelSelect();
    }

    private refreshPresetDropdown(): void {
        this.presetSelect.empty();
        this.presetSelect.createEl('option', { value: '', text: t('Select prompt preset') });
        this.editPresets.forEach(preset => {
            this.presetSelect.createEl('option', { value: preset.id, text: preset.name });
        });
    }

    private updateModelSelect(): void {
        this.modelSelect.empty();

        this.quickSwitchModels.forEach(model => {
            const key = `${model.provider}|${model.modelId}`;
            const displayName = `${model.displayName || model.modelId} | ${formatProviderName(model.provider)}`;
            this.modelSelect.createEl('option', { value: key, text: displayName });
        });

        if (this.selectedModel && this.modelSelect.querySelector(`option[value="${this.selectedModel}"]`)) {
            this.modelSelect.value = this.selectedModel;
        } else if (this.quickSwitchModels.length > 0) {
            const firstKey = `${this.quickSwitchModels[0].provider}|${this.quickSwitchModels[0].modelId}`;
            this.modelSelect.value = firstKey;
            this.selectedModel = firstKey;
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
        const prompt = this.inputEl.value.trim();
        if (!prompt) {
            new Notice(t('Enter instructions'));
            return;
        }

        if (this.isGenerating) {
            new Notice(t('Generation in progress'));
            return;
        }

        // 获取当前文档 - 支持多种视图类型
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension !== 'md') {
            new Notice(t('No active file'));
            return;
        }

        const file = activeFile;
        const docContent = await this.app.vault.read(file);

        // 添加用户消息
        this.addMessage('user', prompt);
        this.inputEl.value = '';

        // 更新 UI 状态
        this.isGenerating = true;
        this.generateBtn.textContent = t('Generating');
        this.generateBtn.addClass('generating');

        try {
            // 创建 ApiManager
            const localApiManager = this.createLocalApiManager();

            // 构建系统提示
            const systemPrompt = buildEditModeSystemPrompt(this.plugin.settings.editSystemPrompt);

            // 提取文档中的内嵌图片
            const images = await this.extractDocumentImages(docContent, file.path);

            // 构建用户消息（包含完整文档上下文）
            let userMsg = `Document content:\n${docContent}\n\nInstruction:\n${prompt}`;

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
                
                // 优先使用 AI 返回的 summary，否则根据修改内容生成
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
                // 非 JSON 响应，当作纯文本回复
                summary = response.substring(0, 200) + (response.length > 200 ? '...' : '');
            }

            // 添加 AI 回复（仅显示摘要）
            this.addMessage('assistant', summary);

            // 如果有具体修改，使用 patch 方式应用
            if (globalChanges.length > 0) {
                // 有 patch 修改，显示确认对话框
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
            } else if (replacementText && replacementText !== docContent) {
                // 有全文替换，显示 Diff Modal
                const context = {
                    nodeId: '',
                    selectedText: docContent,
                    preText: '',
                    postText: '',
                    fullText: docContent,
                    fileNode: file
                };

                new DiffModal(
                    this.app,
                    context,
                    replacementText,
                    async () => {
                        await this.app.vault.modify(file, replacementText);
                        new Notice(t('File updated'));
                    },
                    () => {
                        // 取消
                    }
                ).open();
            }

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.addMessage('assistant', `Error: ${errorMsg}`);
            console.error('Sidebar CoPilot Error:', error);
        } finally {
            this.isGenerating = false;
            this.generateBtn.textContent = t('Generate');
            this.generateBtn.removeClass('generating');
        }
    }

    private createLocalApiManager(): ApiManager {
        if (!this.selectedModel) {
            return new ApiManager(this.plugin.settings);
        }

        const [provider, modelId] = this.selectedModel.split('|');
        if (!provider || !modelId) {
            return new ApiManager(this.plugin.settings);
        }

        const localSettings = { ...this.plugin.settings, apiProvider: provider as ApiProvider };

        if (provider === 'openrouter') {
            localSettings.openRouterTextModel = modelId;
        } else if (provider === 'gemini') {
            localSettings.geminiTextModel = modelId;
        } else if (provider === 'yunwu') {
            localSettings.yunwuTextModel = modelId;
        } else if (provider === 'gptgod') {
            localSettings.gptGodTextModel = modelId;
        }

        return new ApiManager(localSettings);
    }

    // ========== Preset Management ==========

    private handlePresetAdd(): void {
        new InputModal(
            this.app,
            t('New Preset'),
            t('Enter preset name'),
            '',
            (name) => {
                const newPreset: PromptPreset = {
                    id: this.generateId(),
                    name: name,
                    prompt: this.inputEl.value
                };
                this.editPresets.push(newPreset);
                this.plugin.settings.editPresets = this.editPresets;
                void this.plugin.saveSettings();
                this.refreshPresetDropdown();
                this.presetSelect.value = newPreset.id;
            }
        ).open();
    }

    private handlePresetDelete(): void {
        const selectedId = this.presetSelect.value;
        if (!selectedId) {
            new Notice(t('Please select preset delete'));
            return;
        }
        const preset = this.editPresets.find(p => p.id === selectedId);
        if (!preset) return;

        new ConfirmModal(
            this.app,
            t('Delete Preset Confirm', { name: preset.name }),
            () => {
                this.editPresets = this.editPresets.filter(p => p.id !== selectedId);
                this.plugin.settings.editPresets = this.editPresets;
                void this.plugin.saveSettings();
                this.refreshPresetDropdown();
            }
        ).open();
    }

    private handlePresetSave(): void {
        const selectedId = this.presetSelect.value;
        if (!selectedId) {
            new Notice(t('Please select preset save'));
            return;
        }
        const preset = this.editPresets.find(p => p.id === selectedId);
        if (!preset) return;

        preset.prompt = this.inputEl.value;
        this.plugin.settings.editPresets = this.editPresets;
        void this.plugin.saveSettings();
        new Notice(t('Preset saved', { name: preset.name }));
    }

    private handlePresetRename(): void {
        const selectedId = this.presetSelect.value;
        if (!selectedId) {
            new Notice(t('Please select preset rename'));
            return;
        }
        const preset = this.editPresets.find(p => p.id === selectedId);
        if (!preset) return;

        new InputModal(
            this.app,
            t('Rename Preset'),
            t('Enter new name'),
            preset.name,
            (newName) => {
                preset.name = newName;
                this.plugin.settings.editPresets = this.editPresets;
                void this.plugin.saveSettings();
                this.refreshPresetDropdown();
                this.presetSelect.value = selectedId;
            }
        ).open();
    }

    private generateId(): string {
        return Date.now().toString(36) + Math.random().toString(36).substring(2, 11);
    }

    /**
     * 添加外部消息到对话历史（供悬浮面板调用）
     */
    public addExternalMessage(role: 'user' | 'assistant', content: string): void {
        this.addMessage(role, content);
    }

    /**
     * 更新最后一条 AI 消息的内容（用于 Diff 拒绝后的状态更新）
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
                console.debug(`Sidebar CoPilot: Image limit (${MAX_IMAGES}) reached, skipping remaining`);
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
                console.warn('Sidebar CoPilot: Failed to read embedded image:', imgPath, e);
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
}
