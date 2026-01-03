/**
 * Notes Edit Palette
 * 浮动面板，包含 Edit Mode 和 Image Mode 两个 Tab
 */

import { App, Notice, Scope, setIcon } from 'obsidian';
import { ApiManager } from '../api/api-manager';
import { PromptPreset, QuickSwitchModel } from '../settings/settings';
import { PresetManager } from '../ui/preset-manager';
import { t } from '../../lang/helpers';
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

export type NotesPaletteMode = PaletteMode;

export interface NotesImageOptions {
    resolution: string;
    aspectRatio: string;
}

export class NotesEditPalette {
    private containerEl: HTMLElement;
    private promptInput: HTMLTextAreaElement;
    private isVisible: boolean = false;
    private onGenerate: ((prompt: string, mode: NotesPaletteMode) => Promise<void>) | null = null;
    private onClose: (() => void) | null = null;

    private apiManager: ApiManager;
    private pendingTaskCount: number = 0;

    // Mode Controller
    private modeController: ModeController;

    // UI Elements (from shared builders)
    private tabs: TabsElements;
    private presetRow: PresetRowElements;
    private editModelRow: { container: HTMLElement; select: HTMLSelectElement };
    private imageOptions: ImageOptionsElements;

    // Preset data
    private editPresets: PromptPreset[] = [];
    private imagePresets: PromptPreset[] = [];
    private onEditPresetChange: ((presets: PromptPreset[]) => void) | null = null;
    private onImagePresetChange: ((presets: PromptPreset[]) => void) | null = null;

    // Model selection
    private quickSwitchTextModels: QuickSwitchModel[] = [];
    private selectedTextModel: string = '';
    private onTextModelChange: ((modelKey: string) => void) | null = null;
    private quickSwitchImageModels: QuickSwitchModel[] = [];
    private selectedImageModel: string = '';
    private onImageModelChange: ((modelKey: string) => void) | null = null;

    // Image options
    private defaultResolution: string = '1K';
    private defaultAspectRatio: string = '16:9';
    private onImageOptionsChange: ((options: NotesImageOptions) => void) | null = null;

    private onModeChange: ((mode: NotesPaletteMode) => void) | null = null;

    private app: App;
    private scope: Scope;
    private presetManager: PresetManager;

    constructor(app: App, apiManager: ApiManager) {
        this.app = app;
        this.apiManager = apiManager;
        this.scope = new Scope(this.app.scope);

        // Ctrl+Enter 触发生成
        this.scope.register(['Ctrl'], 'Enter', (evt: KeyboardEvent) => {
            evt.preventDefault();
            this.handleGenerate();
            return false;
        });

        this.containerEl = this.createPaletteDOM();
        this.promptInput = this.containerEl.querySelector('.notes-ai-prompt-input') as HTMLTextAreaElement;

        // 管理 Scope
        this.promptInput.addEventListener('focus', () => {
            this.app.keymap.pushScope(this.scope);
        });
        this.promptInput.addEventListener('blur', () => {
            this.app.keymap.popScope(this.scope);
        });

        this.promptInput.addEventListener('input', () => {
            this.updateGenerateButtonState();
        });

        // 初始化 PresetManager
        this.presetManager = new PresetManager(this.app, {
            getPresets: () => this.getCurrentPresets(),
            setPresets: (presets) => this.setCurrentPresets(presets),
            getInputValue: () => this.promptInput.value,
            getSelectValue: () => this.presetRow.select.value,
            refreshDropdown: () => this.refreshPresetDropdown(),
            setSelectValue: (id) => { this.presetRow.select.value = id; }
        });

        document.body.appendChild(this.containerEl);
    }

    setOnGenerate(callback: (prompt: string, mode: NotesPaletteMode) => Promise<void>): void {
        this.onGenerate = callback;
    }

    setOnClose(callback: () => void): void {
        this.onClose = callback;
    }

    setOnModeChange(callback: (mode: NotesPaletteMode) => void): void {
        this.onModeChange = callback;
    }

    private createPaletteDOM(): HTMLElement {
        const container = document.createElement('div');
        container.addClass('notes-ai-palette');
        container.addClass('canvas-ai-palette');
        container.addClass('is-hidden');

        container.addEventListener('mousedown', (e) => e.stopPropagation());
        container.addEventListener('click', (e) => e.stopPropagation());

        // Header with Tabs
        const header = container.createDiv('canvas-ai-palette-header notes-ai-palette-header');
        this.tabs = createTabs(header);
        // 浮动面板不需要 Chat Tab，隐藏它
        this.tabs.chatBtn.addClass('is-hidden');
        const closeBtn = header.createEl('button', { cls: 'canvas-ai-close-btn' });
        setIcon(closeBtn, 'x');

        // Body
        const body = container.createDiv('canvas-ai-palette-body');

        // Preset Row (using shared builder)
        this.presetRow = createPresetRow(body);

        // Prompt Input
        this.promptInput = body.createEl('textarea', {
            cls: 'canvas-ai-prompt-input notes-ai-prompt-input',
            attr: { placeholder: t('Enter instructions'), rows: '4' }
        });

        // Edit Model Selection Row
        const editOptionsContainer = body.createDiv({ cls: 'canvas-ai-chat-options' });
        this.editModelRow = createModelSelectRow(editOptionsContainer, t('Palette Model'));

        // Image Options (using shared builder)
        this.imageOptions = createImageOptionsRow(body);

        // Action Row
        const actionRow = body.createDiv('canvas-ai-action-row');
        const generateBtn = actionRow.createEl('button', { cls: 'canvas-ai-generate-btn', text: t('Generate') });

        // Initialize ModeController
        this.modeController = new ModeController({
            editTabBtn: this.tabs.editBtn,
            imageTabBtn: this.tabs.imageBtn,
            textTabBtn: null,  // 浮动面板不支持 Chat
            editOptionsEl: editOptionsContainer,
            imageOptionsEl: this.imageOptions.container,
            textOptionsEl: null,  // 浮动面板不支持 Chat
            promptInput: this.promptInput
        }, {
            onModeChange: (mode) => {
                this.refreshPresetDropdown();
                this.updateGenerateButtonState();
                this.onModeChange?.(mode);
            }
        });

        // Event Bindings
        this.tabs.editBtn.addEventListener('click', () => this.modeController.handleUserSwitch('edit'));
        this.tabs.imageBtn.addEventListener('click', () => this.modeController.handleUserSwitch('image'));

        closeBtn.addEventListener('click', () => this.hide());
        generateBtn.addEventListener('click', () => this.handleGenerate());

        // Preset events
        const applyPreset = () => {
            const selectedId = this.presetRow.select.value;
            if (selectedId) {
                const presets = this.getCurrentPresets();
                const p = presets.find(x => x.id === selectedId);
                if (p) {
                    this.promptInput.value = p.prompt;
                    this.updateGenerateButtonState();
                }
            }
        };
        this.presetRow.select.addEventListener('change', applyPreset);
        this.presetRow.select.addEventListener('click', applyPreset);

        this.presetRow.addBtn.addEventListener('click', () => this.presetManager.handleAdd());
        this.presetRow.deleteBtn.addEventListener('click', () => this.presetManager.handleDelete());
        this.presetRow.saveBtn.addEventListener('click', () => this.presetManager.handleSave());
        this.presetRow.renameBtn.addEventListener('click', () => this.presetManager.handleRename());

        // Model change events
        this.editModelRow.select.addEventListener('change', () => {
            const value = this.editModelRow.select.value;
            this.selectedTextModel = value;
            this.onTextModelChange?.(value);
        });

        this.imageOptions.modelSelect.addEventListener('change', () => {
            const value = this.imageOptions.modelSelect.value;
            this.selectedImageModel = value;
            this.onImageModelChange?.(value);
        });

        this.imageOptions.resolutionSelect.addEventListener('change', () => this.emitImageOptionsChange());
        this.imageOptions.aspectRatioSelect.addEventListener('change', () => this.emitImageOptionsChange());

        // Keyboard isolation
        setupKeyboardIsolation(this.promptInput);

        return container;
    }

    /**
     * 外部程序切换 Tab (不触发 onModeChange)
     */
    public setMode(mode: NotesPaletteMode): void {
        if (this.modeController.setMode(mode)) {
            this.refreshPresetDropdown();
            this.updateGenerateButtonState();
        }
    }

    setEditBlocked(blocked: boolean): void {
        this.modeController.setEditBlocked(blocked);
    }

    setImageBlocked(blocked: boolean): void {
        this.modeController.setImageBlocked(blocked);
    }

    private emitImageOptionsChange(): void {
        if (this.onImageOptionsChange) {
            this.onImageOptionsChange({
                resolution: this.imageOptions.resolutionSelect.value,
                aspectRatio: this.imageOptions.aspectRatioSelect.value
            });
        }
    }

    // ========== Preset Management ==========

    private getCurrentPresets(): PromptPreset[] {
        return this.modeController.getMode() === 'edit' ? this.editPresets : this.imagePresets;
    }

    private setCurrentPresets(presets: PromptPreset[]): void {
        if (this.modeController.getMode() === 'edit') {
            this.editPresets = presets;
            this.onEditPresetChange?.(presets);
        } else {
            this.imagePresets = presets;
            this.onImagePresetChange?.(presets);
        }
    }

    private refreshPresetDropdown(): void {
        refreshPresetSelect(this.presetRow.select, this.getCurrentPresets());
    }

    // ========== Model Selection ==========

    initQuickSwitchModels(
        textModels: QuickSwitchModel[],
        selectedTextModel: string,
        imageModels: QuickSwitchModel[],
        selectedImageModel: string
    ): void {
        this.quickSwitchTextModels = textModels;
        this.selectedTextModel = selectedTextModel;
        this.quickSwitchImageModels = imageModels;
        this.selectedImageModel = selectedImageModel;
        this.updateTextModelSelect();
        this.updateImageModelSelect();
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

    setOnTextModelChange(callback: (modelKey: string) => void): void {
        this.onTextModelChange = callback;
    }

    setOnImageModelChange(callback: (modelKey: string) => void): void {
        this.onImageModelChange = callback;
    }

    getSelectedTextModel(): string {
        return this.selectedTextModel;
    }

    getSelectedImageModel(): string {
        return this.selectedImageModel;
    }

    // ========== Presets ==========

    initPresets(editPresets: PromptPreset[], imagePresets: PromptPreset[]): void {
        this.editPresets = [...editPresets];
        this.imagePresets = [...imagePresets];
        this.refreshPresetDropdown();
    }

    refreshFromSettings(
        editPresets: PromptPreset[],
        imagePresets: PromptPreset[],
        textModels: QuickSwitchModel[],
        selectedTextModel: string,
        imageModels: QuickSwitchModel[],
        selectedImageModel: string,
        resolution: string,
        aspectRatio: string
    ): void {
        this.initPresets(editPresets, imagePresets);
        this.initQuickSwitchModels(textModels, selectedTextModel, imageModels, selectedImageModel);
        this.initImageOptions(resolution, aspectRatio);
    }

    setOnEditPresetChange(callback: (presets: PromptPreset[]) => void): void {
        this.onEditPresetChange = callback;
    }

    setOnImagePresetChange(callback: (presets: PromptPreset[]) => void): void {
        this.onImagePresetChange = callback;
    }

    // ========== Image Options ==========

    initImageOptions(resolution: string, aspectRatio: string): void {
        this.defaultResolution = resolution;
        this.defaultAspectRatio = aspectRatio;
        this.imageOptions.resolutionSelect.value = resolution;
        this.imageOptions.aspectRatioSelect.value = aspectRatio;
    }

    setOnImageOptionsChange(callback: (options: NotesImageOptions) => void): void {
        this.onImageOptionsChange = callback;
    }

    getImageOptions(): NotesImageOptions {
        return {
            resolution: this.imageOptions.resolutionSelect.value || this.defaultResolution,
            aspectRatio: this.imageOptions.aspectRatioSelect.value || this.defaultAspectRatio
        };
    }

    // ========== Generate ==========

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

        const hasPrompt = this.promptInput.value.trim().length > 0;
        const allowEmpty = this.modeController.getMode() === 'image';
        generateBtn.disabled = !hasPrompt && !allowEmpty && this.pendingTaskCount === 0;
        generateBtn.toggleClass('disabled', generateBtn.disabled);
    }

    private handleGenerate(): void {
        const prompt = this.promptInput.value.trim();
        const mode = this.modeController.getMode();

        if (mode === 'edit' && !prompt) {
            new Notice(t('Enter instructions'));
            return;
        }

        if (!this.apiManager.isConfigured()) {
            new Notice('API not configured');
            return;
        }

        if (this.onGenerate) {
            this.pendingTaskCount++;
            this.updateGenerateButtonState();
            this.hide();

            void this.onGenerate(prompt, mode).finally(() => {
                this.pendingTaskCount = Math.max(0, this.pendingTaskCount - 1);
                this.updateGenerateButtonState();
            });
        }
    }

    getPrompt(): string {
        return this.promptInput.value.trim();
    }

    getCurrentMode(): NotesPaletteMode {
        return this.modeController.getMode();
    }

    clearPrompt(): void {
        this.promptInput.value = '';
    }

    // ========== Show/Hide ==========

    show(x: number, y: number): void {
        this.containerEl.addClass('is-measuring');
        this.containerEl.removeClass('is-hidden');

        const rect = this.containerEl.getBoundingClientRect();
        const panelWidth = rect.width || 320;
        const panelHeight = rect.height || 300;
        const padding = 10;

        let finalX = x;
        let finalY = y;

        if (finalX + panelWidth > window.innerWidth - padding) {
            finalX = window.innerWidth - panelWidth - padding;
        }
        if (finalX < padding) {
            finalX = padding;
        }
        if (finalY + panelHeight > window.innerHeight - padding) {
            const aboveY = y - panelHeight - 40;
            finalY = aboveY >= padding ? aboveY : window.innerHeight - panelHeight - padding;
        }
        if (finalY < padding) {
            finalY = padding;
        }

        this.containerEl.style.left = `${finalX}px`;
        this.containerEl.style.top = `${finalY}px`;
        this.containerEl.removeClass('is-measuring');
        this.isVisible = true;

        setTimeout(() => this.promptInput.focus(), 50);
        this.updateGenerateButtonState();
    }

    hide(): void {
        this.containerEl.addClass('is-hidden');
        this.isVisible = false;
        this.onClose?.();
    }

    get visible(): boolean {
        return this.isVisible;
    }

    destroy(): void {
        this.containerEl.remove();
    }
}
