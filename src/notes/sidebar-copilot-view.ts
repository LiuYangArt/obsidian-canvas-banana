/**
 * Sidebar CoPilot View
 * Notes AI 侧边栏视图，提供多轮对话、文档编辑和图片生成功能
 */

import { ItemView, WorkspaceLeaf, Notice, Scope, Editor } from 'obsidian';
import type CanvasAIPlugin from '../../main';
import { PromptPreset, QuickSwitchModel, ApiProvider } from '../settings/settings';
import { ConfirmModal, DiffModal } from '../ui/modals';
import { PresetManager } from '../ui/preset-manager';
import { buildEditModeSystemPrompt } from '../prompts/edit-mode-prompt';
import { applyPatches, TextChange } from './text-patcher';
import { t } from '../../lang/helpers';
import { extractDocumentImages } from '../utils/image-utils';
import { NotesSelectionContext } from './notes-selection-handler';
import { ApiManager } from '../api/api-manager';
import { ModeController, PaletteMode } from './mode-controller';
import {
    createTabs,
    createPresetRow,
    createModelSelectRow,
    createImageOptionsRow,
    refreshPresetSelect,
    updateModelSelect,
    setupKeyboardIsolation,
    TabsElements,
    PresetRowElements,
    ImageOptionsElements
} from './shared-ui-builder';

export const VIEW_TYPE_SIDEBAR_COPILOT = 'canvas-ai-sidebar-copilot';

type SidebarMode = PaletteMode;

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

    // Mode Controller and UI Elements
    private modeController: ModeController;
    private tabs: TabsElements;
    private presetRow: PresetRowElements;
    private editModelRow: { container: HTMLElement; select: HTMLSelectElement };
    private imageOptions: ImageOptionsElements;
    private chatOptionsContainer: HTMLElement;

    // Settings
    private editPresets: PromptPreset[] = [];
    private imagePresets: PromptPreset[] = [];
    private quickSwitchTextModels: QuickSwitchModel[] = [];
    private quickSwitchImageModels: QuickSwitchModel[] = [];
    private selectedTextModel: string = '';
    private selectedImageModel: string = '';

    // State
    private isGenerating: boolean = false;
    private pendingTaskCount: number = 0;

    // Selection context
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

    // eslint-disable-next-line @typescript-eslint/require-await -- Obsidian ItemView interface requires async signature but no await needed
    async onOpen(): Promise<void> {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('sidebar-copilot-container');

        this.createDOM(container);

        // Initialize PresetManager after DOM is created
        this.presetManager = new PresetManager(this.app, {
            getPresets: () => this.getCurrentPresets(),
            setPresets: (presets) => this.setCurrentPresets(presets),
            getInputValue: () => this.inputEl?.value || '',
            getSelectValue: () => this.presetRow.select?.value || '',
            refreshDropdown: () => this.refreshPresetDropdown(),
            setSelectValue: (id) => { if (this.presetRow.select) this.presetRow.select.value = id; }
        });

        this.initFromSettings();
        this.registerActiveFileListener();
    }

    // eslint-disable-next-line @typescript-eslint/require-await -- Obsidian ItemView interface requires async signature but no await needed
    async onClose(): Promise<void> {
        this.chatHistory = [];
        this.currentDocPath = null;
    }

    private createDOM(container: HTMLElement): void {
        // Header
        const header = container.createDiv('sidebar-copilot-header');
        header.createDiv({ cls: 'sidebar-copilot-title', text: t('Canvas Banana') });

        // Messages Area
        this.messagesContainer = container.createDiv('sidebar-chat-messages');

        // Not Supported Message
        this.notSupportedEl = container.createDiv('sidebar-not-supported');
        this.notSupportedEl.addClass('is-hidden');
        this.notSupportedEl.createEl('p', {
            cls: 'sidebar-not-supported-text',
            text: t('Notes AI only works with markdown files')
        });

        // Footer
        this.footerEl = container.createDiv('sidebar-copilot-footer');

        // Tabs (using shared builder)
        this.tabs = createTabs(this.footerEl);

        // Preset Row (using shared builder)
        this.presetRow = createPresetRow(this.footerEl);

        // Input Textarea
        this.inputEl = this.footerEl.createEl('textarea', {
            cls: 'canvas-ai-prompt-input',
            attr: { placeholder: t('Enter instructions'), rows: '3' }
        });

        // Edit Model Selection (using shared builder)
        const editOptionsContainer = this.footerEl.createDiv('canvas-ai-chat-options');
        this.editModelRow = createModelSelectRow(editOptionsContainer, t('Palette Model'));

        // Image Options (using shared builder)
        this.imageOptions = createImageOptionsRow(this.footerEl);

        // Chat Options (hidden by default, shown when Chat tab is active)
        this.chatOptionsContainer = this.footerEl.createDiv('canvas-ai-chat-mode-options is-hidden');

        // Action Row
        const actionRow = this.footerEl.createDiv('canvas-ai-action-row');
        this.generateBtn = actionRow.createEl('button', { cls: 'canvas-ai-generate-btn', text: t('Generate') });

        // Initialize ModeController
        this.modeController = new ModeController({
            editTabBtn: this.tabs.editBtn,
            imageTabBtn: this.tabs.imageBtn,
            chatTabBtn: this.tabs.chatBtn,
            editOptionsEl: editOptionsContainer,
            imageOptionsEl: this.imageOptions.container,
            chatOptionsEl: this.chatOptionsContainer,
            promptInput: this.inputEl
        }, {
            onModeChange: (mode) => {
                this.refreshPresetDropdown();
                this.onModeChange?.(mode);
            }
        });

        // Event Bindings
        this.tabs.editBtn.addEventListener('click', () => this.modeController.handleUserSwitch('edit'));
        this.tabs.imageBtn.addEventListener('click', () => this.modeController.handleUserSwitch('image'));
        this.tabs.chatBtn.addEventListener('click', () => this.modeController.handleUserSwitch('chat'));

        // Preset events
        const applyPreset = () => {
            const selectedId = this.presetRow.select.value;
            if (selectedId) {
                const presets = this.getCurrentPresets();
                const p = presets.find(x => x.id === selectedId);
                if (p) this.inputEl.value = p.prompt;
            }
        };
        this.presetRow.select.addEventListener('change', applyPreset);
        this.presetRow.select.addEventListener('click', applyPreset);

        this.presetRow.addBtn.addEventListener('click', () => this.presetManager?.handleAdd());
        this.presetRow.deleteBtn.addEventListener('click', () => this.presetManager?.handleDelete());
        this.presetRow.saveBtn.addEventListener('click', () => this.presetManager?.handleSave());
        this.presetRow.renameBtn.addEventListener('click', () => this.presetManager?.handleRename());

        // Model change events
        this.editModelRow.select.addEventListener('change', () => {
            this.selectedTextModel = this.editModelRow.select.value;
            this.plugin.settings.paletteEditModel = this.selectedTextModel;
            void this.plugin.saveSettings();
        });

        this.imageOptions.modelSelect.addEventListener('change', () => {
            this.selectedImageModel = this.imageOptions.modelSelect.value;
            this.plugin.settings.paletteImageModel = this.selectedImageModel;
            void this.plugin.saveSettings();
        });

        this.imageOptions.resolutionSelect.addEventListener('change', () => {
            this.plugin.settings.defaultResolution = this.imageOptions.resolutionSelect.value;
            void this.plugin.saveSettings();
        });

        this.imageOptions.aspectRatioSelect.addEventListener('change', () => {
            this.plugin.settings.defaultAspectRatio = this.imageOptions.aspectRatioSelect.value;
            void this.plugin.saveSettings();
        });

        this.generateBtn.addEventListener('click', () => void this.handleGenerate());

        // Scope management
        this.inputEl.addEventListener('focus', () => {
            this.app.keymap.pushScope(this.keyScope);
            this.captureSelectionOnFocus();
        });
        this.inputEl.addEventListener('blur', () => {
            this.app.keymap.popScope(this.keyScope);
        });

        // Keyboard isolation
        setupKeyboardIsolation(this.inputEl);
    }

    setOnModeChange(callback: (mode: SidebarMode) => void): void {
        this.onModeChange = callback;
    }

    public setMode(mode: SidebarMode): void {
        if (this.modeController.setMode(mode)) {
            this.refreshPresetDropdown();
        }
    }

    public setEditBlocked(blocked: boolean): void {
        this.modeController.setEditBlocked(blocked);
    }

    public setImageBlocked(blocked: boolean): void {
        this.modeController.setImageBlocked(blocked);
    }

    private initFromSettings(): void {
        this.editPresets = [...(this.plugin.settings.editPresets || [])];
        this.imagePresets = [...(this.plugin.settings.imagePresets || [])];
        this.refreshPresetDropdown();

        this.quickSwitchTextModels = [...(this.plugin.settings.quickSwitchTextModels || [])];
        this.quickSwitchImageModels = [...(this.plugin.settings.quickSwitchImageModels || [])];
        this.selectedTextModel = this.plugin.settings.paletteEditModel || '';
        this.selectedImageModel = this.plugin.settings.paletteImageModel || '';
        this.updateTextModelSelect();
        this.updateImageModelSelect();

        if (this.imageOptions.resolutionSelect) {
            this.imageOptions.resolutionSelect.value = this.plugin.settings.defaultResolution || '1K';
        }
        if (this.imageOptions.aspectRatioSelect) {
            this.imageOptions.aspectRatioSelect.value = this.plugin.settings.defaultAspectRatio || '1:1';
        }
    }

    public refreshFromSettings(): void {
        this.editPresets = [...(this.plugin.settings.editPresets || [])];
        this.imagePresets = [...(this.plugin.settings.imagePresets || [])];
        this.refreshPresetDropdown();

        this.quickSwitchTextModels = [...(this.plugin.settings.quickSwitchTextModels || [])];
        this.quickSwitchImageModels = [...(this.plugin.settings.quickSwitchImageModels || [])];
        this.selectedTextModel = this.plugin.settings.paletteEditModel || '';
        this.selectedImageModel = this.plugin.settings.paletteImageModel || '';
        this.updateTextModelSelect();
        this.updateImageModelSelect();

        if (this.imageOptions.resolutionSelect) {
            this.imageOptions.resolutionSelect.value = this.plugin.settings.defaultResolution || '1K';
        }
        if (this.imageOptions.aspectRatioSelect) {
            this.imageOptions.aspectRatioSelect.value = this.plugin.settings.defaultAspectRatio || '1:1';
        }
    }

    private getCurrentPresets(): PromptPreset[] {
        return this.modeController.getMode() === 'edit' ? this.editPresets : this.imagePresets;
    }

    private setCurrentPresets(presets: PromptPreset[]): void {
        if (this.modeController.getMode() === 'edit') {
            this.editPresets = presets;
            this.plugin.settings.editPresets = presets;
        } else {
            this.imagePresets = presets;
            this.plugin.settings.imagePresets = presets;
        }
        void this.plugin.saveSettings();
    }

    private refreshPresetDropdown(): void {
        refreshPresetSelect(this.presetRow.select, this.getCurrentPresets());
    }

    private updateTextModelSelect(): void {
        this.selectedTextModel = updateModelSelect(
            this.editModelRow.select,
            this.quickSwitchTextModels,
            this.selectedTextModel
        );
    }

    private updateImageModelSelect(): void {
        this.selectedImageModel = updateModelSelect(
            this.imageOptions.modelSelect,
            this.quickSwitchImageModels,
            this.selectedImageModel
        );
    }

    private registerActiveFileListener(): void {
        this.registerEvent(
            this.app.workspace.on('file-open', (file) => {
                if (file && file.path !== this.currentDocPath) {
                    this.currentDocPath = file.path;
                    this.clearConversation(true);
                }
                this.updateViewState();
            })
        );

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
        const mode = this.modeController.getMode();
        if (mode === 'image') {
            return this.handleImageGenerate();
        } else if (mode === 'chat') {
            return this.handleChatGenerate();
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

        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension !== 'md') {
            new Notice(t('No active file'));
            return;
        }

        const file = activeFile;
        const docContent = await this.app.vault.read(file);

        const notesHandler = this.plugin.getNotesHandler();
        if (notesHandler) {
            const latestContext = notesHandler.getLastContext();
            if (latestContext) {
                this.capturedContext = latestContext;
            }
        }

        const context = this.capturedContext;
        const hasSelection = context && context.selectedText && context.selectedText.trim().length > 0;

        this.addMessage('user', prompt);
        this.inputEl.value = '';

        this.isGenerating = true;
        this.generateBtn.textContent = t('Generating');
        this.generateBtn.addClass('generating');
        this.setImageBlocked(true);

        notesHandler?.setFloatingButtonGenerating(true);
        notesHandler?.clearHighlightForSidebar();

        try {
            const localApiManager = this.createLocalApiManager('text');
            const systemPrompt = buildEditModeSystemPrompt(this.plugin.settings.editSystemPrompt);

            let userMsg: string;
            let images: { base64: string; mimeType: string; type: 'image' | 'pdf' }[] = [];

            if (hasSelection) {
                userMsg = `Target Text:\n${context.selectedText}\n\nInstruction:\n${prompt}`;
                const extractedImages = await extractDocumentImages(this.app, context.selectedText, file.path, this.plugin.settings);
                images = extractedImages.map(img => ({ ...img, type: 'image' as const }));
            } else {
                userMsg = `Document content:\n${docContent}\n\nInstruction:\n${prompt}`;
                const extractedImages = await extractDocumentImages(this.app, docContent, file.path, this.plugin.settings);
                images = extractedImages.map(img => ({ ...img, type: 'image' as const }));
            }

            if (this.chatHistory.length > 2) {
                const historyContext = this.chatHistory.slice(0, -1).map(m =>
                    `${m.role === 'user' ? 'User' : 'AI'}: ${m.content}`
                ).join('\n');
                userMsg = `Previous conversation:\n${historyContext}\n\n${userMsg}`;
            }

            let response: string;
            if (images.length > 0) {
                response = await localApiManager.multimodalChat(userMsg, images, systemPrompt, 0.5);
            } else {
                response = await localApiManager.chatCompletion(userMsg, systemPrompt, 0.5);
            }

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

            this.addMessage('assistant', summary);

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
                let originalText: string;
                let proposedText: string;

                if (hasSelection && context) {
                    originalText = context.selectedText;
                    proposedText = context.preText + replacementText + context.postText;
                } else {
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
                            if (hasSelection && context?.editor) {
                                const newEndOffset = context.preText.length + replacementText.length;
                                this.selectTextRange(context.editor, context.preText.length, newEndOffset);
                            }
                        },
                        () => { /* cancel */ }
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
            this.setImageBlocked(false);
            const notesHandler = this.plugin.getNotesHandler();
            notesHandler?.setFloatingButtonGenerating(false);
            this.clearCapturedContext();
        }
    }

    private handleImageGenerate(): void {
        const prompt = this.inputEl.value.trim();

        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension !== 'md') {
            new Notice(t('No active file'));
            return;
        }

        const notesHandler = this.plugin.getNotesHandler();
        if (!notesHandler) {
            new Notice(t('Services not initialized'));
            return;
        }

        const latestContext = notesHandler.getLastContext();
        if (latestContext) {
            this.capturedContext = latestContext;
        }

        const context = this.capturedContext;
        const hasSelection = context && context.selectedText && context.selectedText.trim().length > 0;

        const instruction = prompt || (hasSelection ? context.selectedText : t('Generate image from context'));

        this.addMessage('user', instruction);
        this.inputEl.value = '';

        this.pendingTaskCount++;
        this.updateGenerateButtonState();

        try {
            notesHandler.handleImageGeneration(instruction, context)
                .catch(err => {
                    const msg = err instanceof Error ? err.message : String(err);
                    console.error('Sidebar Image Error:', err);
                    this.addMessage('assistant', `Error: ${msg}`);
                })
                .finally(() => {
                    this.pendingTaskCount = Math.max(0, this.pendingTaskCount - 1);
                    this.updateGenerateButtonState();
                });

            this.addMessage('assistant', t('Generating image based on your request'));

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.addMessage('assistant', `Error: ${errorMsg}`);
            console.error('Sidebar CoPilot Error:', error);

            this.pendingTaskCount = Math.max(0, this.pendingTaskCount - 1);
            this.updateGenerateButtonState();
        }
    }

    private async handleChatGenerate(): Promise<void> {
        const prompt = this.inputEl.value.trim();
        if (!prompt) {
            new Notice(t('Ask a question'));
            return;
        }

        if (this.isGenerating) {
            new Notice(t('Generation in progress'));
            return;
        }

        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension !== 'md') {
            new Notice(t('No active file'));
            return;
        }

        const file = activeFile;
        const docContent = await this.app.vault.read(file);

        const notesHandler = this.plugin.getNotesHandler();
        if (notesHandler) {
            const latestContext = notesHandler.getLastContext();
            if (latestContext) {
                this.capturedContext = latestContext;
            }
        }

        const context = this.capturedContext;
        const hasSelection = context && context.selectedText && context.selectedText.trim().length > 0;

        this.addMessage('user', prompt);
        this.inputEl.value = '';

        this.isGenerating = true;
        this.generateBtn.textContent = t('Generating');
        this.generateBtn.addClass('generating');

        notesHandler?.clearHighlightForSidebar();

        try {
            const localApiManager = this.createLocalApiManager('text');
            const systemPrompt = 'You are a helpful assistant. Answer questions based on the provided context. Respond in the same language as the user\'s question.';

            let userMsg: string;
            let images: { base64: string; mimeType: string; type: 'image' | 'pdf' }[] = [];

            if (hasSelection) {
                userMsg = `Context (selected text):\n${context.selectedText}\n\nQuestion:\n${prompt}`;
                const extractedImages = await extractDocumentImages(this.app, context.selectedText, file.path, this.plugin.settings);
                images = extractedImages.map(img => ({ ...img, type: 'image' as const }));
            } else {
                userMsg = `Context (document content):\n${docContent}\n\nQuestion:\n${prompt}`;
                const extractedImages = await extractDocumentImages(this.app, docContent, file.path, this.plugin.settings);
                images = extractedImages.map(img => ({ ...img, type: 'image' as const }));
            }

            if (this.chatHistory.length > 2) {
                const historyContext = this.chatHistory.slice(0, -1).map(m =>
                    `${m.role === 'user' ? 'User' : 'AI'}: ${m.content}`
                ).join('\n');
                userMsg = `Previous conversation:\n${historyContext}\n\n${userMsg}`;
            }

            let response: string;
            if (images.length > 0) {
                response = await localApiManager.multimodalChat(userMsg, images, systemPrompt, 0.7);
            } else {
                response = await localApiManager.chatCompletion(userMsg, systemPrompt, 0.7);
            }

            this.addMessage('assistant', response);

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.addMessage('assistant', `Error: ${errorMsg}`);
            console.error('Sidebar Chat Error:', error);
        } finally {
            this.isGenerating = false;
            this.generateBtn.textContent = t('Generate');
            this.generateBtn.removeClass('generating');
            this.clearCapturedContext();
        }
    }

    private updateGenerateButtonState(): void {
        if (!this.generateBtn) return;

        if (this.pendingTaskCount === 0) {
            this.generateBtn.textContent = t('Generate');
            this.generateBtn.removeClass('generating');
        } else {
            this.generateBtn.textContent = `${t('Generating')} ${this.pendingTaskCount} ${t('Tasks')}`;
            this.generateBtn.addClass('generating');
        }

        this.generateBtn.disabled = false;
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

    public addExternalMessage(role: 'user' | 'assistant', content: string): void {
        this.addMessage(role, content);
    }

    public updateLastAssistantMessage(content: string): void {
        if (this.chatHistory.length === 0) return;

        const lastMsg = this.chatHistory[this.chatHistory.length - 1];
        if (lastMsg.role === 'assistant') {
            lastMsg.content = content;

            const lastMsgEl = this.messagesContainer.lastElementChild;
            if (lastMsgEl) {
                const contentEl = lastMsgEl.querySelector('.sidebar-message-content');
                if (contentEl) {
                    contentEl.textContent = content;
                }
            }
        }
    }

    private captureSelectionOnFocus(): void {
        const notesHandler = this.plugin.getNotesHandler();
        if (notesHandler) {
            const context = notesHandler.getLastContext();
            if (context) {
                this.capturedContext = context;
            }
        }
    }

    private clearCapturedContext(): void {
        this.capturedContext = null;
        const notesHandler = this.plugin.getNotesHandler();
        if (notesHandler) {
            notesHandler.clearHighlightForSidebar();
        }
    }

    private selectTextRange(editor: Editor, startOffset: number, endOffset: number): void {
        const notesHandler = this.plugin.getNotesHandler();
        if (notesHandler) {
            const startPos = editor.offsetToPos(startOffset);
            const endPos = editor.offsetToPos(endOffset);
            notesHandler.selectGeneratedText(editor, startPos, endPos);
        }
    }
}
