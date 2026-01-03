/**
 * Floating Palette Component
 * 浮动面板组件 - 提供 AI 交互界面
 */

import { App, Notice, Scope, setIcon } from 'obsidian';
import { ApiManager } from '../api/api-manager';
import { PromptPreset, QuickSwitchModel } from '../settings/settings';
import { InputModal, ConfirmModal } from './modals';
import { t } from '../../lang/helpers';
import { formatProviderName } from '../utils/format-utils';

// Palette Mode Type
export type PaletteMode = 'chat' | 'image' | 'node' | 'edit';

// ========== Floating Palette Component ==========
export class FloatingPalette {
    private containerEl: HTMLElement;
    private currentMode: PaletteMode = 'chat';
    private promptInput: HTMLTextAreaElement;
    private isVisible: boolean = false;
    private currentParent: HTMLElement | null = null;
    private onClose: (() => void) | null = null;
    private onDebug: ((mode: PaletteMode) => void) | null = null;
    private onGenerate: ((prompt: string, mode: PaletteMode) => Promise<void>) | null = null;
    private onSettingsChange: ((key: 'aspectRatio' | 'resolution', value: string) => void) | null = null;

    private apiManager: ApiManager;
    private pendingTaskCount: number = 0;
    // Track text node count for generate button state
    private currentTextCount: number = 0;
    // Image generation options (no model selection - always use Pro)
    private imageAspectRatio: string = '1:1';
    private imageResolution: string = '1K';

    // Chat thinking options
    private thinkingEnabled: boolean = false;
    private thinkingBudget: string = '8K';

    // DOM references for image options
    private imageOptionsEl: HTMLElement | null = null;
    private chatOptionsEl: HTMLElement | null = null;
    private editOptionsEl: HTMLElement | null = null;
    private ratioSelect: HTMLSelectElement | null = null;
    private resolutionSelect: HTMLSelectElement | null = null;
    private nodeOptionsEl: HTMLElement | null = null;
    private thinkingToggleEl: HTMLInputElement | null = null;
    private budgetSelectEl: HTMLSelectElement | null = null;

    private debugBtnEl: HTMLButtonElement | null = null;
    private versionInfoEl: HTMLElement | null = null;

    // Preset related
    private presetSelect: HTMLSelectElement | null = null;
    private presetAddBtn: HTMLButtonElement | null = null;
    private presetDeleteBtn: HTMLButtonElement | null = null;
    private presetSaveBtn: HTMLButtonElement | null = null;
    private presetRenameBtn: HTMLButtonElement | null = null;
    private chatPresets: PromptPreset[] = [];
    private imagePresets: PromptPreset[] = [];
    private nodePresets: PromptPreset[] = [];
    private editPresets: PromptPreset[] = [];
    private onPresetChange: ((presets: PromptPreset[], mode: PaletteMode) => void) | null = null;
    private app: App;
    private scope: Scope;

    // Quick switch model selection
    private textModelSelectEl: HTMLSelectElement | null = null;
    private imageModelSelectEl: HTMLSelectElement | null = null;
    private nodeModelSelectEl: HTMLSelectElement | null = null;
    private editModelSelectEl: HTMLSelectElement | null = null;
    private quickSwitchTextModels: QuickSwitchModel[] = [];
    private quickSwitchImageModels: QuickSwitchModel[] = [];
    private selectedTextModel: string = '';  // Format: "provider|modelId"
    private selectedImageModel: string = '';
    private selectedNodeModel: string = '';
    private selectedEditModel: string = '';
    private onModelChange: ((mode: PaletteMode, modelKey: string) => void) | null = null;

    constructor(app: App, apiManager: ApiManager, onDebugCallback?: (mode: PaletteMode) => void) {
        this.app = app;
        this.apiManager = apiManager;
        this.onDebug = onDebugCallback || null;
        this.scope = new Scope(this.app.scope);

        // Register Ctrl+Enter in this scope to trigger generate
        // This intercepts Obsidian's keymap system when prompt input is focused
        this.scope.register(['Ctrl'], 'Enter', (evt: KeyboardEvent) => {
            evt.preventDefault();
            this.handleGenerate();
            return false; // Prevent default Obsidian behavior
        });

        this.containerEl = this.createPaletteDOM();
        this.promptInput = this.containerEl.querySelector('.canvas-ai-prompt-input') as HTMLTextAreaElement;

        // Manage Scope on focus/blur
        this.promptInput.addEventListener('focus', () => {
            this.app.keymap.pushScope(this.scope);
        });

        this.promptInput.addEventListener('blur', () => {
            this.app.keymap.popScope(this.scope);
        });

        // Update generate button state when prompt changes
        this.promptInput.addEventListener('input', () => {
            this.updateGenerateButtonState();
        });
    }

    /**
     * Set the generate callback
     */
    setOnGenerate(callback: (prompt: string, mode: PaletteMode) => Promise<void>): void {
        this.onGenerate = callback;
    }

    /**
     * Set the callback for settings change
     */
    setOnSettingsChange(callback: (key: 'aspectRatio' | 'resolution', value: string) => void): void {
        this.onSettingsChange = callback;
    }


    /**
     * Initialize image options from settings
     */
    initImageOptions(aspectRatio: string, resolution: string): void {
        this.imageAspectRatio = aspectRatio;
        this.imageResolution = resolution;

        if (this.ratioSelect) this.ratioSelect.value = aspectRatio;
        if (this.resolutionSelect) this.resolutionSelect.value = resolution;
    }



    /**
     * Set debug mode visibility for the Debug button
     */
    setDebugMode(enabled: boolean): void {
        if (this.debugBtnEl) {
            if (enabled) {
                this.debugBtnEl.removeClass('is-hidden');
            } else {
                this.debugBtnEl.addClass('is-hidden');
            }
        }
    }

    /**
     * Set version info text dynamically
     */
    setVersion(_version: string): void {
    }


    /**
     * Create Panel DOM Structure
     */
    private createPaletteDOM(): HTMLElement {
        const container = document.createElement('div');
        container.addClass('canvas-ai-palette');
        container.addClass('is-hidden'); // Start hidden, show() will remove this

        container.addEventListener('mousedown', (e) => e.stopPropagation());
        container.addEventListener('click', (e) => e.stopPropagation());

        // Header
        const header = container.createDiv('canvas-ai-palette-header');
        const tabsDiv = header.createDiv('canvas-ai-tabs');

        ['chat', 'image', 'node', 'edit'].forEach(mode => {
            const btn = tabsDiv.createEl('button', {
                cls: `canvas-ai-tab${mode === 'chat' ? ' active' : ''}`,
                text: mode === 'chat' ? t('Text') : mode === 'image' ? t('Image') : mode === 'node' ? t('Node') : t('Edit')
            });
            btn.dataset.mode = mode;
        });

        const closeBtn = header.createEl('button', { cls: 'canvas-ai-close-btn' });
        setIcon(closeBtn, 'x');

        // Body
        const body = container.createDiv('canvas-ai-palette-body');

        // Preset Row
        const presetRow = body.createDiv('canvas-ai-preset-row');
        this.presetSelect = presetRow.createEl('select', 'canvas-ai-preset-select dropdown');
        this.presetSelect.createEl('option', { value: '', text: t('Select prompt preset') });

        const presetActions = presetRow.createDiv('canvas-ai-preset-actions');

        const createPresetBtn = (action: string, title: string, icon: string) => {
            const btn = presetActions.createEl('button', {
                cls: 'canvas-ai-preset-btn',
                attr: { 'data-action': action, 'title': title }
            });
            setIcon(btn, icon);
            return btn;
        };

        this.presetAddBtn = createPresetBtn('add', t('New Preset'), 'circle-plus');
        this.presetDeleteBtn = createPresetBtn('delete', t('Delete'), 'circle-x');
        this.presetSaveBtn = createPresetBtn('save', t('Save'), 'save');
        this.presetRenameBtn = createPresetBtn('rename', t('Rename Preset'), 'book-a');

        // Prompt Input
        this.promptInput = body.createEl('textarea', {
            cls: 'canvas-ai-prompt-input',
            attr: { placeholder: t('Enter instructions'), rows: '4' }
        });

        // Image Options
        this.imageOptionsEl = body.createDiv({ cls: 'canvas-ai-image-options is-hidden' });

        const imgRow = this.imageOptionsEl.createDiv('canvas-ai-option-row');
        const resGrp = imgRow.createEl('span', 'canvas-ai-option-group');
        resGrp.createEl('label', { text: t('Resolution') });
        this.resolutionSelect = resGrp.createEl('select', 'canvas-ai-resolution-select dropdown');
        ['1K', '2K', '4K'].forEach(v => this.resolutionSelect!.createEl('option', { value: v, text: v }));

        const ratioGrp = imgRow.createEl('span', 'canvas-ai-option-group');
        ratioGrp.createEl('label', { text: t('Ratio') });
        this.ratioSelect = ratioGrp.createEl('select', 'canvas-ai-ratio-select dropdown');
        ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'].forEach(v => this.ratioSelect!.createEl('option', { value: v, text: v }));

        const imgModelRow = this.imageOptionsEl.createDiv({ cls: 'canvas-ai-option-row canvas-ai-image-model-select-row is-hidden' });
        const imgModelGrp = imgModelRow.createEl('span', 'canvas-ai-option-group');
        imgModelGrp.createEl('label', { text: t('Palette Model') });
        this.imageModelSelectEl = imgModelGrp.createEl('select', 'canvas-ai-image-model-select dropdown');

        // Chat Options
        this.chatOptionsEl = body.createDiv('canvas-ai-chat-options');

        // Thinking Options Row
        const thinkingRow = this.chatOptionsEl.createDiv('canvas-ai-option-row');
        const thinkingGrp = thinkingRow.createEl('span', 'canvas-ai-option-group');
        thinkingGrp.createEl('label', { text: t('Thinking') });
        this.thinkingToggleEl = thinkingGrp.createEl('input', { type: 'checkbox', cls: 'canvas-ai-thinking-toggle' });

        const budgetGrp = thinkingRow.createEl('span', 'canvas-ai-option-group');
        budgetGrp.createEl('label', { text: t('Budget') });
        this.budgetSelectEl = budgetGrp.createEl('select', 'canvas-ai-budget-select dropdown');
        ['1K', '4K', '8K', '16K', '32K'].forEach(v => this.budgetSelectEl!.createEl('option', { value: v, text: v }));
        this.budgetSelectEl.value = '8K';

        const chatModelRow = this.chatOptionsEl.createDiv({ cls: 'canvas-ai-option-row canvas-ai-model-select-row is-hidden' });
        const chatModelGrp = chatModelRow.createEl('span', 'canvas-ai-option-group');
        chatModelGrp.createEl('label', { text: t('Palette Model') });
        this.textModelSelectEl = chatModelGrp.createEl('select', 'canvas-ai-text-model-select dropdown');

        // Node Options (only model selection, temperature is fixed at 1)
        this.nodeOptionsEl = body.createDiv({ cls: 'canvas-ai-node-options is-hidden' });

        const nodeModelRow = this.nodeOptionsEl.createDiv({ cls: 'canvas-ai-option-row canvas-ai-node-model-select-row is-hidden' });
        const nodeModelGrp = nodeModelRow.createEl('span', 'canvas-ai-option-group');
        nodeModelGrp.createEl('label', { text: t('Palette Model') });
        this.nodeModelSelectEl = nodeModelGrp.createEl('select', 'canvas-ai-node-model-select dropdown');

        // Edit Options (only model selection, temperature is fixed at 1)
        this.editOptionsEl = body.createDiv({ cls: 'canvas-ai-edit-options is-hidden' });

        const editModelRow = this.editOptionsEl.createDiv({ cls: 'canvas-ai-option-row canvas-ai-model-select-row canvas-ai-edit-model-select-row is-hidden' });
        const editModelGrp = editModelRow.createEl('span', 'canvas-ai-option-group');
        editModelGrp.createEl('label', { text: t('Palette Model') });
        this.editModelSelectEl = editModelGrp.createEl('select', 'canvas-ai-edit-model-select dropdown');

        // Action Row
        const actionRow = body.createDiv('canvas-ai-action-row');
        const generateBtn = actionRow.createEl('button', { cls: 'canvas-ai-generate-btn', text: t('Generate') });
        this.debugBtnEl = actionRow.createEl('button', { cls: 'canvas-ai-debug-btn is-hidden', text: t('Debug') });

        // Footer
        const footer = container.createDiv('canvas-ai-palette-footer');
        footer.createEl('span', 'canvas-ai-context-preview');

        // Bindings

        // Tabs
        const tabs = tabsDiv.querySelectorAll('.canvas-ai-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.removeClass('active'));
                tab.addClass('active');
                this.currentMode = tab.getAttribute('data-mode') as PaletteMode;
                this.updatePlaceholder();
                this.updateOptionsVisibility();
                this.refreshPresetDropdown();
            });
        });

        closeBtn.addEventListener('click', () => {
            this.hide();
            this.onClose?.();
        });

        this.debugBtnEl.addEventListener('click', () => {
            this.onDebug?.(this.currentMode);
        });

        generateBtn.addEventListener('click', () => this.handleGenerate());

        if (this.promptInput) {
            const stopPropagation = (e: Event) => e.stopPropagation();
            this.promptInput.addEventListener('keydown', stopPropagation, { capture: true });
            this.promptInput.addEventListener('keyup', stopPropagation);
            this.promptInput.addEventListener('keypress', stopPropagation);
        }

        this.textModelSelectEl?.addEventListener('change', () => {
            const value = this.textModelSelectEl!.value;
            this.selectedTextModel = value;
            this.onModelChange?.('chat', value);
        });

        this.imageModelSelectEl?.addEventListener('change', () => {
            const value = this.imageModelSelectEl!.value;
            this.selectedImageModel = value;
            this.onModelChange?.('image', value);
        });

        this.nodeModelSelectEl?.addEventListener('change', () => {
            const value = this.nodeModelSelectEl!.value;
            this.selectedNodeModel = value;
            this.onModelChange?.('node', value);
        });

        this.editModelSelectEl?.addEventListener('change', () => {
            const value = this.editModelSelectEl!.value;
            this.selectedEditModel = value;
            this.onModelChange?.('edit', value);
        });

        // Temperature is now fixed at 1, no UI controls needed

        this.presetSelect?.addEventListener('change', () => {
            const selectedId = this.presetSelect!.value;
            if (selectedId) {
                const presets = this.currentMode === 'chat'
                    ? this.chatPresets
                    : this.currentMode === 'image'
                        ? this.imagePresets
                        : this.currentMode === 'node'
                            ? this.nodePresets
                            : this.editPresets;
                const p = presets.find(x => x.id === selectedId);
                if (p) {
                    this.promptInput.value = p.prompt;
                    this.updateGenerateButtonState();
                }
            }
        });

        this.presetAddBtn?.addEventListener('click', () => this.handlePresetAdd());
        this.presetDeleteBtn?.addEventListener('click', () => this.handlePresetDelete());
        this.presetSaveBtn?.addEventListener('click', () => this.handlePresetSave());
        this.presetRenameBtn?.addEventListener('click', () => this.handlePresetRename());

        this.ratioSelect?.addEventListener('change', () => {
            this.imageAspectRatio = this.ratioSelect!.value;
            this.onSettingsChange?.('aspectRatio', this.imageAspectRatio);
        });

        this.resolutionSelect?.addEventListener('change', () => {
            this.imageResolution = this.resolutionSelect!.value;
            this.onSettingsChange?.('resolution', this.imageResolution);
        });

        // Thinking toggle and budget select
        this.thinkingToggleEl?.addEventListener('change', () => {
            this.thinkingEnabled = this.thinkingToggleEl!.checked;
        });

        this.budgetSelectEl?.addEventListener('change', () => {
            this.thinkingBudget = this.budgetSelectEl!.value;
        });

        return container;
    }

    /**
     * Show/hide options based on current mode
     */
    private updateOptionsVisibility(): void {
        if (this.imageOptionsEl) {
            if (this.currentMode === 'image') {
                this.imageOptionsEl.removeClass('is-hidden');
            } else {
                this.imageOptionsEl.addClass('is-hidden');
            }
        }
        if (this.chatOptionsEl) {
            if (this.currentMode === 'chat') {
                this.chatOptionsEl.removeClass('is-hidden');
            } else {
                this.chatOptionsEl.addClass('is-hidden');
            }
        }
        if (this.nodeOptionsEl) {
            if (this.currentMode === 'node') {
                this.nodeOptionsEl.removeClass('is-hidden');
            } else {
                this.nodeOptionsEl.addClass('is-hidden');
            }
        }
        if (this.editOptionsEl) {
            if (this.currentMode === 'edit') {
                this.editOptionsEl.removeClass('is-hidden');
            } else {
                this.editOptionsEl.addClass('is-hidden');
            }
        }
    }

    /**
     * Refresh the preset dropdown based on current mode
     */
    private refreshPresetDropdown(): void {
        if (!this.presetSelect) return;

        const presets = this.currentMode === 'chat'
            ? this.chatPresets
            : this.currentMode === 'image'
                ? this.imagePresets
                : this.currentMode === 'node'
                    ? this.nodePresets
                    : this.editPresets;

        this.presetSelect.empty();
        this.presetSelect.createEl('option', { value: '', text: t('Select prompt preset') });

        // Add preset options
        presets.forEach(preset => {
            this.presetSelect!.createEl('option', {
                value: preset.id,
                text: preset.name
            });
        });
    }

    /**
     * Handle Add preset button click
     */
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
                    prompt: this.promptInput.value
                };

                if (this.currentMode === 'chat') {
                    this.chatPresets.push(newPreset);
                    this.onPresetChange?.(this.chatPresets, 'chat');
                } else if (this.currentMode === 'image') {
                    this.imagePresets.push(newPreset);
                    this.onPresetChange?.(this.imagePresets, 'image');
                } else if (this.currentMode === 'node') {
                    this.nodePresets.push(newPreset);
                    this.onPresetChange?.(this.nodePresets, 'node');
                } else {
                    this.editPresets.push(newPreset);
                    this.onPresetChange?.(this.editPresets, 'edit');
                }

                this.refreshPresetDropdown();
                // Focus on new preset
                if (this.presetSelect) {
                    this.presetSelect.value = newPreset.id;
                }
            }
        ).open();
    }

    /**
     * Handle Delete preset button click
     */
    private handlePresetDelete(): void {
        const selectedId = this.presetSelect?.value;
        if (!selectedId) {
            new Notice(t('Please select preset delete'));
            return;
        }

        const presets = this.currentMode === 'chat'
            ? this.chatPresets
            : this.currentMode === 'image'
                ? this.imagePresets
                : this.currentMode === 'node'
                    ? this.nodePresets
                    : this.editPresets;
        const preset = presets.find(p => p.id === selectedId);
        if (!preset) return;

        new ConfirmModal(
            this.app,
            t('Delete Preset Confirm', { name: preset.name }),
            () => {
                if (this.currentMode === 'chat') {
                    this.chatPresets = this.chatPresets.filter(p => p.id !== selectedId);
                    this.onPresetChange?.(this.chatPresets, 'chat');
                } else if (this.currentMode === 'image') {
                    this.imagePresets = this.imagePresets.filter(p => p.id !== selectedId);
                    this.onPresetChange?.(this.imagePresets, 'image');
                } else if (this.currentMode === 'node') {
                    this.nodePresets = this.nodePresets.filter(p => p.id !== selectedId);
                    this.onPresetChange?.(this.nodePresets, 'node');
                } else {
                    this.editPresets = this.editPresets.filter(p => p.id !== selectedId);
                    this.onPresetChange?.(this.editPresets, 'edit');
                }

                this.refreshPresetDropdown();
            }
        ).open();
    }

    /**
     * Handle Save preset button click
     */
    private handlePresetSave(): void {
        const selectedId = this.presetSelect?.value;
        if (!selectedId) {
            new Notice(t('Please select preset save'));
            return;
        }

        const presets = this.currentMode === 'chat'
            ? this.chatPresets
            : this.currentMode === 'image'
                ? this.imagePresets
                : this.currentMode === 'node'
                    ? this.nodePresets
                    : this.editPresets;
        const preset = presets.find(p => p.id === selectedId);
        if (!preset) return;

        preset.prompt = this.promptInput.value;

        if (this.currentMode === 'chat') {
            this.onPresetChange?.(this.chatPresets, 'chat');
        } else if (this.currentMode === 'image') {
            this.onPresetChange?.(this.imagePresets, 'image');
        } else if (this.currentMode === 'node') {
            this.onPresetChange?.(this.nodePresets, 'node');
        } else {
            this.onPresetChange?.(this.editPresets, 'edit');
        }

        new Notice(t('Preset saved', { name: preset.name }));
    }

    /**
     * Handle Rename preset button click
     */
    private handlePresetRename(): void {
        const selectedId = this.presetSelect?.value;
        if (!selectedId) {
            new Notice(t('Please select preset rename'));
            return;
        }

        const presets = this.currentMode === 'chat'
            ? this.chatPresets
            : this.currentMode === 'image'
                ? this.imagePresets
                : this.currentMode === 'node'
                    ? this.nodePresets
                    : this.editPresets;
        const preset = presets.find(p => p.id === selectedId);
        if (!preset) return;

        new InputModal(
            this.app,
            t('Rename Preset'),
            t('Enter new name'),
            preset.name,
            (newName) => {
                preset.name = newName;

                if (this.currentMode === 'chat') {
                    this.onPresetChange?.(this.chatPresets, 'chat');
                } else if (this.currentMode === 'image') {
                    this.onPresetChange?.(this.imagePresets, 'image');
                } else if (this.currentMode === 'node') {
                    this.onPresetChange?.(this.nodePresets, 'node');
                } else {
                    this.onPresetChange?.(this.editPresets, 'edit');
                }

                this.refreshPresetDropdown();
                // Keep selection on renamed preset
                if (this.presetSelect) {
                    this.presetSelect.value = selectedId;
                }
            }
        ).open();
    }

    /**
     * Initialize presets from saved settings
     */
    initPresets(chatPresets: PromptPreset[], imagePresets: PromptPreset[], nodePresets: PromptPreset[] = [], editPresets: PromptPreset[] = []): void {
        this.chatPresets = [...chatPresets];
        this.imagePresets = [...imagePresets];
        this.nodePresets = [...nodePresets];
        this.editPresets = [...editPresets];
        this.refreshPresetDropdown();
    }

    /**
     * Set the preset change callback for persisting presets
     */
    setOnPresetChange(callback: (presets: PromptPreset[], mode: PaletteMode) => void): void {
        this.onPresetChange = callback;
    }

    /**
     * Generate a simple unique ID
     */
    private generateId(): string {
        return Date.now().toString(36) + Math.random().toString(36).substring(2, 11);
    }

    /**
     * 更新输入框提示文本
     */
    private updatePlaceholder(): void {
        if (this.currentMode === 'chat') {
            this.promptInput.placeholder = t('Enter instructions');
        } else if (this.currentMode === 'image') {
            this.promptInput.placeholder = t('Describe the image');
        } else if (this.currentMode === 'node') {
            this.promptInput.placeholder = t('Describe structure');
        } else {
            this.promptInput.placeholder = t('Enter instructions');
        }
    }

    /**
     * 更新上下文预览信息
     */
    updateContextPreview(nodeCount: number, imageCount: number, textCount: number, groupCount: number = 0): void {
        // Track text count for generate button state
        this.currentTextCount = textCount;
        this.updateGenerateButtonState();

        const preview = this.containerEl.querySelector('.canvas-ai-context-preview');
        if (preview) {
            if (nodeCount === 0) {
                preview.textContent = '';
            } else {
                const parts: string[] = [];
                if (imageCount > 0) parts.push(`${imageCount} ${t('Images')}`);
                if (textCount > 0) parts.push(`${textCount} ${t('Text')}`);
                if (groupCount > 0) parts.push(`${groupCount} ${t('Groups')}`);
                preview.textContent = `🔗 ${nodeCount} ${t('Nodes Selected')} (${parts.join(', ')})`;
            }
        }
    }

    /**
     * Increment pending task count and update button
     */
    incrementTaskCount(): void {
        this.pendingTaskCount++;
        this.updateGenerateButtonState();
    }

    /**
     * Decrement pending task count and update button
     */
    decrementTaskCount(): void {
        this.pendingTaskCount = Math.max(0, this.pendingTaskCount - 1);
        this.updateGenerateButtonState();
    }

    /**
     * Update generate button text and disabled state
     * Disabled when: no text nodes selected AND no prompt entered (fool-proof design)
     * Edit mode: disabled when generation in progress (no concurrent edits allowed)
     */
    private updateGenerateButtonState(): void {
        const generateBtn = this.containerEl.querySelector('.canvas-ai-generate-btn') as HTMLButtonElement;
        if (!generateBtn) return;

        if (this.pendingTaskCount === 0) {
            generateBtn.textContent = t('Generate');
            generateBtn.removeClass('generating');
        } else {
            generateBtn.textContent = `${t('Generating')} ${this.pendingTaskCount} ${t('Tasks')}`;
            generateBtn.addClass('generating');
        }

        // FOOLPROOF: disable when no text content AND no prompt
        const hasPrompt = this.promptInput.value.trim().length > 0;
        const hasTextContent = this.currentTextCount > 0;
        
        // Edit mode: no concurrent generation allowed
        const editModeBlocked = this.currentMode === 'edit' && this.pendingTaskCount > 0;
        
        const shouldDisable = editModeBlocked || (!hasPrompt && !hasTextContent && this.pendingTaskCount === 0);

        generateBtn.disabled = shouldDisable;
        if (shouldDisable) {
            generateBtn.addClass('disabled');
        } else {
            generateBtn.removeClass('disabled');
        }
    }

    /**
     * Disable/Enable Edit Tab
     */
    setEditTabEnabled(enabled: boolean): void {
        const editTab = this.containerEl.querySelector('.canvas-ai-tab[data-mode="edit"]');
        if (editTab) {
            if (enabled) {
                editTab.removeClass('disabled');
            } else {
                editTab.addClass('disabled');
                // If currently on edit tab and it gets disabled, switch to chat
                if (this.currentMode === 'edit') {
                    const chatTab = this.containerEl.querySelector('.canvas-ai-tab[data-mode="chat"]') as HTMLElement;
                    chatTab?.click();
                }
            }
        }
    }

    /**
     * 处理生成按钮点击
     */
    private handleGenerate(): void {
        const prompt = this.promptInput.value.trim();
        console.debug('Canvas Banana: Generate clicked');
        console.debug('Mode:', this.currentMode);
        console.debug('Prompt:', prompt || '(empty - will use fallback)');

        // Edit mode: no concurrent generation allowed
        if (this.currentMode === 'edit' && this.pendingTaskCount > 0) {
            new Notice(t('Generation in progress'));
            return;
        }

        // Note: Empty prompt is now allowed - IntentResolver will handle fallback
        // Other modes allow concurrent tasks

        // Check if API is configured
        if (!this.apiManager.isConfigured()) {
            console.error('Canvas Banana: API Key not configured. Please set it in plugin settings.');
            return;
        }

        // Call the onGenerate callback (which will create Ghost Node and handle API call)
        if (this.onGenerate) {
            // Capture current state before hiding palette
            const currentPrompt = prompt;
            const currentMode = this.currentMode;

            // Increment task count immediately
            this.incrementTaskCount();

            // Hide palette
            this.hide();

            // Fire-and-forget: explicitly marked void
            void this.onGenerate(currentPrompt, currentMode)
                .finally(() => {
                    this.decrementTaskCount();
                });
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
     * Get current image generation options
     * Used by plugin to pass selected options to API
     */
    getImageOptions(): { aspectRatio: string, resolution: string } {
        return {
            aspectRatio: this.imageAspectRatio,
            resolution: this.imageResolution
        };
    }

    /**
     * Get current chat options including thinking config
     */
    getChatOptions(): { temperature: number; thinkingEnabled: boolean; thinkingBudget: number } {
        // Convert budget string to token number
        const budgetMap: Record<string, number> = {
            '1K': 1024,
            '4K': 4096,
            '8K': 8192,
            '16K': 16384,
            '32K': 32768
        };
        return {
            temperature: 1,
            thinkingEnabled: this.thinkingEnabled,
            thinkingBudget: budgetMap[this.thinkingBudget] || 8192
        };
    }

    /**
     * Get current node mode options
     */
    getNodeOptions(): { temperature: number } {
        // Temperature is fixed at 1 for optimal results
        return {
            temperature: 1
        };
    }

    /**
     * Get current edit mode options
     */
    getEditOptions(): { temperature: number } {
        // Temperature is fixed at 1 for optimal results
        return {
            temperature: 1
        };
    }



    /**
     * Initialize quick switch models from settings
     */
    initQuickSwitchModels(
        textModels: QuickSwitchModel[],
        imageModels: QuickSwitchModel[],
        selectedTextModel: string,
        selectedImageModel: string,
        selectedNodeModel: string,
        selectedEditModel: string
    ): void {
        this.quickSwitchTextModels = textModels;
        this.quickSwitchImageModels = imageModels;
        this.selectedTextModel = selectedTextModel;
        this.selectedImageModel = selectedImageModel;
        this.selectedNodeModel = selectedNodeModel;
        this.selectedEditModel = selectedEditModel;
        this.updateModelSelects();
    }

    /**
     * Update model select dropdowns based on current mode
     */
    updateModelSelects(): void {
        const hasTextModels = this.quickSwitchTextModels.length > 0;
        const hasImageModels = this.quickSwitchImageModels.length > 0;

        // Helper to populate a select with models
        const populateSelect = (
            selectEl: HTMLSelectElement | null,
            models: QuickSwitchModel[],
            selectedValue: string
        ): string => {
            if (!selectEl) return selectedValue;
            selectEl.empty();

            // Add models from quick switch list (no empty default option)
            // Format: "ModelName | Provider"
            for (const model of models) {
                selectEl.createEl('option', {
                    value: `${model.provider}|${model.modelId}`,
                    text: `${model.displayName} | ${formatProviderName(model.provider)}`
                });
            }

            // If no selection or selection not in list, default to first model
            const validValues = models.map(m => `${m.provider}|${m.modelId}`);
            let finalValue = selectedValue;
            if (!selectedValue || !validValues.includes(selectedValue)) {
                finalValue = validValues.length > 0 ? validValues[0] : '';
            }
            selectEl.value = finalValue;
            return finalValue;
        };

        // Update text model select (chat mode)
        this.selectedTextModel = populateSelect(this.textModelSelectEl, this.quickSwitchTextModels, this.selectedTextModel);
        const textRow = this.textModelSelectEl?.closest('.canvas-ai-model-select-row') as HTMLElement;
        if (textRow) {
            if (hasTextModels) {
                textRow.removeClass('is-hidden');
            } else {
                textRow.addClass('is-hidden');
            }
        }

        // Update node model select (node mode uses same text model list)
        this.selectedNodeModel = populateSelect(this.nodeModelSelectEl, this.quickSwitchTextModels, this.selectedNodeModel);
        const nodeRow = this.nodeModelSelectEl?.closest('.canvas-ai-node-model-select-row') as HTMLElement;
        if (nodeRow) {
            if (hasTextModels) {
                nodeRow.removeClass('is-hidden');
            } else {
                nodeRow.addClass('is-hidden');
            }
        }

        // Update image model select
        this.selectedImageModel = populateSelect(this.imageModelSelectEl, this.quickSwitchImageModels, this.selectedImageModel);
        const imageRow = this.imageModelSelectEl?.closest('.canvas-ai-image-model-select-row') as HTMLElement;
        if (imageRow) {
            if (hasImageModels) {
                imageRow.removeClass('is-hidden');
            } else {
                imageRow.addClass('is-hidden');
            }
        }

        // Update edit model select (edit mode uses same text model list)
        this.selectedEditModel = populateSelect(this.editModelSelectEl, this.quickSwitchTextModels, this.selectedEditModel);
        const editRow = this.editModelSelectEl?.closest('.canvas-ai-edit-model-select-row') as HTMLElement;
        if (editRow) {
            if (hasTextModels) {
                editRow.removeClass('is-hidden');
            } else {
                editRow.addClass('is-hidden');
            }
        }
    }

    /**
     * Set the callback for model change
     */
    setOnModelChange(callback: (mode: PaletteMode, modelKey: string) => void): void {
        this.onModelChange = callback;
    }

    /**
     * Get the currently selected model for a given mode
     * @returns Format: "provider|modelId" or empty string if using default
     */
    getSelectedModel(mode: PaletteMode): string {
        switch (mode) {
            case 'chat':
                return this.selectedTextModel;
            case 'image':
                return this.selectedImageModel;
            case 'node':
                return this.selectedNodeModel;
            case 'edit':
                return this.selectedEditModel;
            default:
                return '';
        }
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
            this.containerEl.addClass('is-hidden');
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
            this.containerEl.removeClass('is-hidden');
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
        this.containerEl.addClass('is-hidden');
        this.isVisible = false;
    }

    /**
     * 获取当前是否可见
     */
    get visible(): boolean {
        return this.isVisible;
    }

    /**
     * 从设置刷新所有配置（供 main.ts 的 notifySettingsChanged 调用）
     */
    refreshFromSettings(
        chatPresets: PromptPreset[],
        imagePresets: PromptPreset[],
        nodePresets: PromptPreset[],
        editPresets: PromptPreset[],
        textModels: QuickSwitchModel[],
        imageModels: QuickSwitchModel[],
        selectedTextModel: string,
        selectedImageModel: string,
        selectedNodeModel: string,
        selectedEditModel: string
    ): void {
        this.initPresets(chatPresets, imagePresets, nodePresets, editPresets);
        this.initQuickSwitchModels(
            textModels,
            imageModels,
            selectedTextModel,
            selectedImageModel,
            selectedNodeModel,
            selectedEditModel
        );
    }

    /**
     * 清理 DOM
     */
    destroy(): void {
        this.containerEl.remove();
    }
}
