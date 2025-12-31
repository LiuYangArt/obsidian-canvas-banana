/**
 * Notes Edit Palette
 * 简化版浮动面板，仅包含 Edit Mode 功能
 */

import { App, Notice, Scope, setIcon } from 'obsidian';
import { ApiManager } from '../api/api-manager';
import { PromptPreset, QuickSwitchModel } from '../settings/settings';
import { InputModal, ConfirmModal } from '../ui/modals';
import { t } from '../../lang/helpers';

export class NotesEditPalette {
    private containerEl: HTMLElement;
    private promptInput: HTMLTextAreaElement;
    private isVisible: boolean = false;
    private currentParent: HTMLElement | null = null;
    private onGenerate: ((prompt: string) => Promise<void>) | null = null;
    private onClose: (() => void) | null = null;

    private apiManager: ApiManager;
    private pendingTaskCount: number = 0;

    // Preset related
    private presetSelect: HTMLSelectElement | null = null;
    private editPresets: PromptPreset[] = [];
    private onPresetChange: ((presets: PromptPreset[]) => void) | null = null;

    // Model selection
    private modelSelectEl: HTMLSelectElement | null = null;
    private quickSwitchModels: QuickSwitchModel[] = [];
    private selectedModel: string = '';
    private onModelChange: ((modelKey: string) => void) | null = null;

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

    setOnGenerate(callback: (prompt: string) => Promise<void>): void {
        this.onGenerate = callback;
    }

    setOnClose(callback: () => void): void {
        this.onClose = callback;
    }

    private createPaletteDOM(): HTMLElement {
        const container = document.createElement('div');
        container.addClass('notes-ai-palette');
        container.addClass('canvas-ai-palette'); // 复用样式
        container.addClass('is-hidden');

        container.addEventListener('mousedown', (e) => e.stopPropagation());
        container.addEventListener('click', (e) => e.stopPropagation());

        // Header
        const header = container.createDiv('canvas-ai-palette-header notes-ai-palette-header');
        header.createEl('span', { cls: 'notes-ai-title', text: t('Edit') });
        const closeBtn = header.createEl('button', { cls: 'canvas-ai-close-btn', text: '×' });

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

        // Model Selection Row
        const modelRow = body.createDiv({ cls: 'canvas-ai-option-row canvas-ai-model-select-row' });
        const modelGrp = modelRow.createEl('span', 'canvas-ai-option-group');
        modelGrp.createEl('label', { text: t('Palette Model') });
        this.modelSelectEl = modelGrp.createEl('select', 'canvas-ai-edit-model-select dropdown');

        // Action Row
        const actionRow = body.createDiv('canvas-ai-action-row');
        const generateBtn = actionRow.createEl('button', { cls: 'canvas-ai-generate-btn', text: t('Generate') });

        // Bindings
        closeBtn.addEventListener('click', () => this.hide());
        generateBtn.addEventListener('click', () => this.handleGenerate());

        this.presetSelect.addEventListener('change', () => {
            const selectedId = this.presetSelect!.value;
            if (selectedId) {
                const p = this.editPresets.find(x => x.id === selectedId);
                if (p) this.promptInput.value = p.prompt;
            }
        });

        presetAddBtn.addEventListener('click', () => this.handlePresetAdd());
        presetDeleteBtn.addEventListener('click', () => this.handlePresetDelete());
        presetSaveBtn.addEventListener('click', () => this.handlePresetSave());
        presetRenameBtn.addEventListener('click', () => this.handlePresetRename());

        this.modelSelectEl.addEventListener('change', () => {
            const value = this.modelSelectEl!.value;
            this.selectedModel = value;
            this.onModelChange?.(value);
        });

        // 阻止键盘事件冒泡
        const stopPropagation = (e: Event) => e.stopPropagation();
        this.promptInput.addEventListener('keydown', stopPropagation, { capture: true });
        this.promptInput.addEventListener('keyup', stopPropagation);
        this.promptInput.addEventListener('keypress', stopPropagation);

        return container;
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
                    prompt: this.promptInput.value
                };
                this.editPresets.push(newPreset);
                this.onPresetChange?.(this.editPresets);
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
        const preset = this.editPresets.find(p => p.id === selectedId);
        if (!preset) return;

        new ConfirmModal(
            this.app,
            t('Delete Preset Confirm', { name: preset.name }),
            () => {
                this.editPresets = this.editPresets.filter(p => p.id !== selectedId);
                this.onPresetChange?.(this.editPresets);
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
        const preset = this.editPresets.find(p => p.id === selectedId);
        if (!preset) return;

        preset.prompt = this.promptInput.value;
        this.onPresetChange?.(this.editPresets);
        new Notice(t('Preset saved', { name: preset.name }));
    }

    private handlePresetRename(): void {
        const selectedId = this.presetSelect?.value;
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
                this.onPresetChange?.(this.editPresets);
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
        this.editPresets.forEach(preset => {
            this.presetSelect!.createEl('option', { value: preset.id, text: preset.name });
        });
    }

    private generateId(): string {
        return Date.now().toString(36) + Math.random().toString(36).substring(2, 11);
    }

    // ========== Model Selection ==========

    initQuickSwitchModels(models: QuickSwitchModel[], selectedModel: string): void {
        this.quickSwitchModels = models;
        this.selectedModel = selectedModel;
        this.updateModelSelect();
    }

    private updateModelSelect(): void {
        if (!this.modelSelectEl) return;
        this.modelSelectEl.empty();

        const formatProviderName = (provider: string): string => {
            switch (provider.toLowerCase()) {
                case 'openrouter': return 'OpenRouter';
                case 'yunwu': return 'Yunwu';
                case 'gemini': return 'Gemini';
                case 'gptgod': return 'GPTGod';
                default: return provider.charAt(0).toUpperCase() + provider.slice(1);
            }
        };

        this.quickSwitchModels.forEach(model => {
            const key = `${model.provider}|${model.modelId}`;
            const displayName = `${model.displayName || model.modelId} | ${formatProviderName(model.provider)}`;
            this.modelSelectEl!.createEl('option', { value: key, text: displayName });
        });

        if (this.selectedModel && this.modelSelectEl.querySelector(`option[value="${this.selectedModel}"]`)) {
            this.modelSelectEl.value = this.selectedModel;
        } else if (this.quickSwitchModels.length > 0) {
            const firstKey = `${this.quickSwitchModels[0].provider}|${this.quickSwitchModels[0].modelId}`;
            this.modelSelectEl.value = firstKey;
            this.selectedModel = firstKey;
        }
    }

    setOnModelChange(callback: (modelKey: string) => void): void {
        this.onModelChange = callback;
    }

    getSelectedModel(): string {
        return this.selectedModel;
    }

    // ========== Presets ==========

    initPresets(presets: PromptPreset[]): void {
        this.editPresets = [...presets];
        this.refreshPresetDropdown();
    }

    setOnPresetChange(callback: (presets: PromptPreset[]) => void): void {
        this.onPresetChange = callback;
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
        generateBtn.disabled = !hasPrompt && this.pendingTaskCount === 0;
        if (generateBtn.disabled) {
            generateBtn.addClass('disabled');
        } else {
            generateBtn.removeClass('disabled');
        }
    }

    private handleGenerate(): void {
        const prompt = this.promptInput.value.trim();
        if (!prompt) {
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

            void this.onGenerate(prompt).finally(() => {
                this.pendingTaskCount = Math.max(0, this.pendingTaskCount - 1);
                this.updateGenerateButtonState();
            });
        }
    }

    getPrompt(): string {
        return this.promptInput.value.trim();
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
