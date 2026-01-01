/**
 * Notes Edit Palette
 * 浮动面板，包含 Edit Mode 和 Image Mode 两个 Tab
 */

import { App, Notice, Scope, setIcon } from 'obsidian';
import { ApiManager } from '../api/api-manager';
import { PromptPreset, QuickSwitchModel } from '../settings/settings';
import { InputModal, ConfirmModal } from '../ui/modals';
import { t } from '../../lang/helpers';
import { formatProviderName } from '../utils/format-utils';

export type NotesPaletteMode = 'edit' | 'image';

export interface NotesImageOptions {
    resolution: string;
    aspectRatio: string;
}

export class NotesEditPalette {
    private containerEl: HTMLElement;
    private promptInput: HTMLTextAreaElement;
    private isVisible: boolean = false;
    private currentParent: HTMLElement | null = null;
    private onGenerate: ((prompt: string, mode: NotesPaletteMode) => Promise<void>) | null = null;
    private onClose: (() => void) | null = null;

    private apiManager: ApiManager;
    private pendingTaskCount: number = 0;

    // Tab & Mode
    private currentMode: NotesPaletteMode = 'edit';
    private tabsEl: HTMLElement | null = null;
    private editTabBtn: HTMLButtonElement | null = null;
    private imageTabBtn: HTMLButtonElement | null = null;
    private imageOptionsEl: HTMLElement | null = null;

    // Preset related
    private presetSelect: HTMLSelectElement | null = null;
    private editPresets: PromptPreset[] = [];
    private imagePresets: PromptPreset[] = [];
    private onEditPresetChange: ((presets: PromptPreset[]) => void) | null = null;
    private onImagePresetChange: ((presets: PromptPreset[]) => void) | null = null;

    // Edit Model selection
    private editModelSelectEl: HTMLSelectElement | null = null;
    private editModelOptionsEl: HTMLElement | null = null;
    private quickSwitchTextModels: QuickSwitchModel[] = [];
    private selectedTextModel: string = '';
    private onTextModelChange: ((modelKey: string) => void) | null = null;

    // Image Model selection
    private imageModelSelectEl: HTMLSelectElement | null = null;
    private quickSwitchImageModels: QuickSwitchModel[] = [];
    private selectedImageModel: string = '';
    private onImageModelChange: ((modelKey: string) => void) | null = null;

    // Image options
    private resolutionSelect: HTMLSelectElement | null = null;
    private aspectRatioSelect: HTMLSelectElement | null = null;
    private defaultResolution: string = '1K';
    private defaultAspectRatio: string = '16:9';
    private onImageOptionsChange: ((options: NotesImageOptions) => void) | null = null;

    private app: App;
    private scope: Scope;

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

        document.body.appendChild(this.containerEl);
    }

    setOnGenerate(callback: (prompt: string, mode: NotesPaletteMode) => Promise<void>): void {
        this.onGenerate = callback;
    }

    setOnClose(callback: () => void): void {
        this.onClose = callback;
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

        // Tab 容器
        this.tabsEl = header.createDiv('canvas-ai-tabs');
        this.editTabBtn = this.tabsEl.createEl('button', { cls: 'canvas-ai-tab active', text: t('Edit') });
        this.imageTabBtn = this.tabsEl.createEl('button', { cls: 'canvas-ai-tab', text: t('Image') });

        const closeBtn = header.createEl('button', { cls: 'canvas-ai-close-btn', text: '×' });

        // Tab 切换事件
        this.editTabBtn.addEventListener('click', () => this.switchMode('edit'));
        this.imageTabBtn.addEventListener('click', () => this.switchMode('image'));

        // Body
        const body = container.createDiv('canvas-ai-palette-body');

        // Preset Row
        const presetRow = body.createDiv('canvas-ai-preset-row');
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

        // Prompt Input
        this.promptInput = body.createEl('textarea', {
            cls: 'canvas-ai-prompt-input notes-ai-prompt-input',
            attr: { placeholder: t('Enter instructions'), rows: '4' }
        });

        // Edit Model Selection Row (for Edit mode)
        this.editModelOptionsEl = body.createDiv({ cls: 'canvas-ai-option-row canvas-ai-model-select-row' });
        const editModelGrp = this.editModelOptionsEl.createEl('span', 'canvas-ai-option-group');
        editModelGrp.createEl('label', { text: t('Palette Model') });
        this.editModelSelectEl = editModelGrp.createEl('select', 'canvas-ai-edit-model-select dropdown');

        // Image Options (for Image mode, hidden by default)
        this.imageOptionsEl = body.createDiv({ cls: 'canvas-ai-image-options is-hidden' });

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

        // Image Model row
        const imageOptRow2 = this.imageOptionsEl.createDiv('canvas-ai-option-row canvas-ai-model-select-row');
        const imageModelGrp = imageOptRow2.createEl('span', 'canvas-ai-option-group');
        imageModelGrp.createEl('label', { text: t('Palette Model') });
        this.imageModelSelectEl = imageModelGrp.createEl('select', 'canvas-ai-image-model-select dropdown');

        // Action Row
        const actionRow = body.createDiv('canvas-ai-action-row');
        const generateBtn = actionRow.createEl('button', { cls: 'canvas-ai-generate-btn', text: t('Generate') });

        // Bindings
        closeBtn.addEventListener('click', () => this.hide());
        generateBtn.addEventListener('click', () => this.handleGenerate());

        this.presetSelect.addEventListener('change', () => {
            const selectedId = this.presetSelect!.value;
            if (selectedId) {
                const presets = this.currentMode === 'edit' ? this.editPresets : this.imagePresets;
                const p = presets.find(x => x.id === selectedId);
                if (p) this.promptInput.value = p.prompt;
            }
        });

        presetAddBtn.addEventListener('click', () => this.handlePresetAdd());
        presetDeleteBtn.addEventListener('click', () => this.handlePresetDelete());
        presetSaveBtn.addEventListener('click', () => this.handlePresetSave());
        presetRenameBtn.addEventListener('click', () => this.handlePresetRename());

        this.editModelSelectEl.addEventListener('change', () => {
            const value = this.editModelSelectEl!.value;
            this.selectedTextModel = value;
            this.onTextModelChange?.(value);
        });

        this.imageModelSelectEl.addEventListener('change', () => {
            const value = this.imageModelSelectEl!.value;
            this.selectedImageModel = value;
            this.onImageModelChange?.(value);
        });

        this.resolutionSelect.addEventListener('change', () => this.emitImageOptionsChange());
        this.aspectRatioSelect.addEventListener('change', () => this.emitImageOptionsChange());

        // 阻止键盘事件冒泡
        const stopPropagation = (e: Event) => e.stopPropagation();
        this.promptInput.addEventListener('keydown', stopPropagation, { capture: true });
        this.promptInput.addEventListener('keyup', stopPropagation);
        this.promptInput.addEventListener('keypress', stopPropagation);

        return container;
    }

    private switchMode(mode: NotesPaletteMode): void {
        if (this.currentMode === mode) return;
        this.currentMode = mode;

        // 更新 Tab 状态
        if (this.editTabBtn && this.imageTabBtn) {
            this.editTabBtn.toggleClass('active', mode === 'edit');
            this.imageTabBtn.toggleClass('active', mode === 'image');
        }

        // 更新 options 显示
        if (this.editModelOptionsEl && this.imageOptionsEl) {
            this.editModelOptionsEl.toggleClass('is-hidden', mode !== 'edit');
            this.imageOptionsEl.toggleClass('is-hidden', mode !== 'image');
        }

        // 更新 placeholder
        if (mode === 'edit') {
            this.promptInput.placeholder = t('Enter instructions');
        } else {
            this.promptInput.placeholder = t('Describe the image');
        }

        // 刷新 preset dropdown
        this.refreshPresetDropdown();
    }

    private emitImageOptionsChange(): void {
        if (this.onImageOptionsChange && this.resolutionSelect && this.aspectRatioSelect) {
            this.onImageOptionsChange({
                resolution: this.resolutionSelect.value,
                aspectRatio: this.aspectRatioSelect.value
            });
        }
    }

    // ========== Preset Management ==========

    private getCurrentPresets(): PromptPreset[] {
        return this.currentMode === 'edit' ? this.editPresets : this.imagePresets;
    }

    private setCurrentPresets(presets: PromptPreset[]): void {
        if (this.currentMode === 'edit') {
            this.editPresets = presets;
            this.onEditPresetChange?.(presets);
        } else {
            this.imagePresets = presets;
            this.onImagePresetChange?.(presets);
        }
    }

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
                const presets = [...this.getCurrentPresets(), newPreset];
                this.setCurrentPresets(presets);
                this.refreshPresetDropdown();
                if (this.presetSelect) {
                    this.presetSelect.value = newPreset.id;
                }
            }
        ).open();
    }

    private handlePresetDelete(): void {
        const selectedId = this.presetSelect?.value;
        if (!selectedId) {
            new Notice(t('Please select preset delete'));
            return;
        }
        const presets = this.getCurrentPresets();
        const preset = presets.find(p => p.id === selectedId);
        if (!preset) return;

        new ConfirmModal(
            this.app,
            t('Delete Preset Confirm', { name: preset.name }),
            () => {
                const newPresets = presets.filter(p => p.id !== selectedId);
                this.setCurrentPresets(newPresets);
                this.refreshPresetDropdown();
            }
        ).open();
    }

    private handlePresetSave(): void {
        const selectedId = this.presetSelect?.value;
        if (!selectedId) {
            new Notice(t('Please select preset save'));
            return;
        }
        const presets = this.getCurrentPresets();
        const preset = presets.find(p => p.id === selectedId);
        if (!preset) return;

        preset.prompt = this.promptInput.value;
        this.setCurrentPresets([...presets]);
        new Notice(t('Preset saved', { name: preset.name }));
    }

    private handlePresetRename(): void {
        const selectedId = this.presetSelect?.value;
        if (!selectedId) {
            new Notice(t('Please select preset rename'));
            return;
        }
        const presets = this.getCurrentPresets();
        const preset = presets.find(p => p.id === selectedId);
        if (!preset) return;

        new InputModal(
            this.app,
            t('Rename Preset'),
            t('Enter new name'),
            preset.name,
            (newName) => {
                preset.name = newName;
                this.setCurrentPresets([...presets]);
                this.refreshPresetDropdown();
                if (this.presetSelect) {
                    this.presetSelect.value = selectedId;
                }
            }
        ).open();
    }

    private refreshPresetDropdown(): void {
        if (!this.presetSelect) return;
        this.presetSelect.empty();
        this.presetSelect.createEl('option', { value: '', text: t('Select prompt preset') });
        const presets = this.getCurrentPresets();
        presets.forEach(preset => {
            this.presetSelect!.createEl('option', { value: preset.id, text: preset.name });
        });
    }

    private generateId(): string {
        return Date.now().toString(36) + Math.random().toString(36).substring(2, 11);
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
        if (!this.editModelSelectEl) return;
        this.editModelSelectEl.empty();

        this.quickSwitchTextModels.forEach(model => {
            const key = `${model.provider}|${model.modelId}`;
            const displayName = `${model.displayName || model.modelId} | ${formatProviderName(model.provider)}`;
            this.editModelSelectEl!.createEl('option', { value: key, text: displayName });
        });

        if (this.selectedTextModel && this.editModelSelectEl.querySelector(`option[value="${this.selectedTextModel}"]`)) {
            this.editModelSelectEl.value = this.selectedTextModel;
        } else if (this.quickSwitchTextModels.length > 0) {
            const firstKey = `${this.quickSwitchTextModels[0].provider}|${this.quickSwitchTextModels[0].modelId}`;
            this.editModelSelectEl.value = firstKey;
            this.selectedTextModel = firstKey;
        }
    }

    private updateImageModelSelect(): void {
        if (!this.imageModelSelectEl) return;
        this.imageModelSelectEl.empty();

        this.quickSwitchImageModels.forEach(model => {
            const key = `${model.provider}|${model.modelId}`;
            const displayName = `${model.displayName || model.modelId} | ${formatProviderName(model.provider)}`;
            this.imageModelSelectEl!.createEl('option', { value: key, text: displayName });
        });

        if (this.selectedImageModel && this.imageModelSelectEl.querySelector(`option[value="${this.selectedImageModel}"]`)) {
            this.imageModelSelectEl.value = this.selectedImageModel;
        } else if (this.quickSwitchImageModels.length > 0) {
            const firstKey = `${this.quickSwitchImageModels[0].provider}|${this.quickSwitchImageModels[0].modelId}`;
            this.imageModelSelectEl.value = firstKey;
            this.selectedImageModel = firstKey;
        }
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
        if (this.resolutionSelect) this.resolutionSelect.value = resolution;
        if (this.aspectRatioSelect) this.aspectRatioSelect.value = aspectRatio;
    }

    setOnImageOptionsChange(callback: (options: NotesImageOptions) => void): void {
        this.onImageOptionsChange = callback;
    }

    getImageOptions(): NotesImageOptions {
        return {
            resolution: this.resolutionSelect?.value || this.defaultResolution,
            aspectRatio: this.aspectRatioSelect?.value || this.defaultAspectRatio
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

        // Image mode 允许空 prompt（使用选中文本）
        const hasPrompt = this.promptInput.value.trim().length > 0;
        const allowEmpty = this.currentMode === 'image';
        generateBtn.disabled = !hasPrompt && !allowEmpty && this.pendingTaskCount === 0;
        if (generateBtn.disabled) {
            generateBtn.addClass('disabled');
        } else {
            generateBtn.removeClass('disabled');
        }
    }

    private handleGenerate(): void {
        const prompt = this.promptInput.value.trim();

        // Edit mode 必须有 prompt
        if (this.currentMode === 'edit' && !prompt) {
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

            void this.onGenerate(prompt, this.currentMode).finally(() => {
                this.pendingTaskCount = Math.max(0, this.pendingTaskCount - 1);
                this.updateGenerateButtonState();
            });
        }
    }

    getPrompt(): string {
        return this.promptInput.value.trim();
    }

    getCurrentMode(): NotesPaletteMode {
        return this.currentMode;
    }

    clearPrompt(): void {
        this.promptInput.value = '';
    }

    // ========== Show/Hide ==========

    show(x: number, y: number): void {
        // 使用 is-measuring 类测量尺寸（保持布局但不可见）
        this.containerEl.addClass('is-measuring');
        this.containerEl.removeClass('is-hidden');

        // 获取面板实际尺寸
        const rect = this.containerEl.getBoundingClientRect();
        const panelWidth = rect.width || 320;
        const panelHeight = rect.height || 300;
        const padding = 10;

        // 计算最终位置，确保不超出视口
        let finalX = x;
        let finalY = y;

        // 右边界检测
        if (finalX + panelWidth > window.innerWidth - padding) {
            finalX = window.innerWidth - panelWidth - padding;
        }

        // 左边界检测
        if (finalX < padding) {
            finalX = padding;
        }

        // 下边界检测：如果下方空间不足，尝试显示在上方
        if (finalY + panelHeight > window.innerHeight - padding) {
            const aboveY = y - panelHeight - 40;
            if (aboveY >= padding) {
                finalY = aboveY;
            } else {
                finalY = window.innerHeight - panelHeight - padding;
            }
        }

        // 上边界检测
        if (finalY < padding) {
            finalY = padding;
        }

        // 应用最终位置并显示
        this.containerEl.style.left = `${finalX}px`;
        this.containerEl.style.top = `${finalY}px`;
        this.containerEl.removeClass('is-measuring');
        this.isVisible = true;

        // 自动聚焦输入框
        setTimeout(() => this.promptInput.focus(), 50);
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
