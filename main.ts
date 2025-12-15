import { App, ItemView, Modal, Notice, Plugin, PluginSettingTab, Setting, setIcon, setTooltip, TFile, Scope } from 'obsidian';
import type { Canvas, CanvasNode, CanvasCoords } from './types';
import { CanvasConverter, ConvertedNode } from './canvas-converter';
import { ApiManager } from './api-manager';
import { IntentResolver, ResolvedIntent } from './intent-resolver';
import { extractCanvasJSON, remapCoordinates, regenerateIds, optimizeLayout, sanitizeCanvasData, CanvasData } from './node-mode-utils';
import { t } from './lang/helpers';

// ========== Plugin Settings Interfaces ==========
export type ApiProvider = 'openrouter' | 'yunwu' | 'gemini' | 'gptgod';

export interface QuickSwitchModel {
    provider: ApiProvider;
    modelId: string;
    displayName: string;
}

export interface CanvasAISettings {
    // API Provider selection
    apiProvider: ApiProvider;
    // OpenRouter settings
    openRouterApiKey: string;
    openRouterBaseUrl: string;
    openRouterTextModel: string;
    openRouterImageModel: string;
    openRouterUseCustomTextModel: boolean;
    openRouterUseCustomImageModel: boolean;

    // Yunwu settings
    yunwuApiKey: string;
    yunwuBaseUrl: string;
    yunwuTextModel: string;
    yunwuImageModel: string;
    yunwuUseCustomTextModel: boolean;
    yunwuUseCustomImageModel: boolean;

    // Google Gemini settings
    geminiApiKey: string;
    geminiTextModel: string;
    geminiImageModel: string;
    geminiUseCustomTextModel: boolean;
    geminiUseCustomImageModel: boolean;

    // GPTGod settings
    gptGodApiKey: string;
    gptGodBaseUrl: string;
    gptGodTextModel: string;
    gptGodImageModel: string;
    gptGodUseCustomTextModel: boolean;
    gptGodUseCustomImageModel: boolean;



    // Legacy fields (for migration)
    textModel?: string;
    imageModel?: string;
    useCustomTextModel?: boolean;
    useCustomImageModel?: boolean;

    imageCompressionQuality: number;  // WebP compression quality (0-100)
    imageMaxSize: number;  // Max width/height for WebP output
    // Image generation defaults (palette state)
    defaultAspectRatio: string;
    defaultResolution: string;
    defaultChatTemperature: number;

    // Debug mode
    debugMode: boolean;

    // System prompts for different modes
    chatSystemPrompt: string;
    nodeSystemPrompt: string;
    imageSystemPrompt: string;

    // Node mode settings
    nodeDefaultColor: string;  // Override color for generated nodes ("1"-"6" or empty)

    // Prompt presets - separate for chat, image, and node modes
    chatPresets: PromptPreset[];
    imagePresets: PromptPreset[];
    nodePresets: PromptPreset[];
    // Node mode temperature
    defaultNodeTemperature: number;

    // Image generation timeout (seconds)
    imageGenerationTimeout: number;

    // Quick switch models
    quickSwitchTextModels: QuickSwitchModel[];
    quickSwitchImageModels: QuickSwitchModel[];
    paletteTextModel: string;
    paletteImageModel: string;
    paletteNodeModel: string;
}

const DEFAULT_SETTINGS: CanvasAISettings = {
    apiProvider: 'openrouter',

    openRouterApiKey: '',
    openRouterBaseUrl: 'https://openrouter.ai/api/v1/chat/completions',
    openRouterTextModel: 'google/gemini-2.5-flash',
    openRouterImageModel: 'google/gemini-3-pro-image-preview', // Placeholder default
    openRouterUseCustomTextModel: false,
    openRouterUseCustomImageModel: false,

    yunwuApiKey: '',
    yunwuBaseUrl: 'https://yunwu.ai',
    yunwuTextModel: 'gemini-2.5-flash',
    yunwuImageModel: 'gemini-3-pro-image-preview',
    yunwuUseCustomTextModel: false,
    yunwuUseCustomImageModel: false,

    geminiApiKey: '',
    geminiTextModel: 'gemini-2.5-flash',
    geminiImageModel: 'gemini-3-pro-image-preview',
    geminiUseCustomTextModel: false,
    geminiUseCustomImageModel: false,

    gptGodApiKey: '',
    gptGodBaseUrl: 'https://api.gptgod.online',
    gptGodTextModel: 'gemini-2.5-flash',
    gptGodImageModel: 'gemini-3-pro-image-preview',
    gptGodUseCustomTextModel: false,
    gptGodUseCustomImageModel: false,



    imageCompressionQuality: 80,  // Default 80% quality
    imageMaxSize: 2048,  // Default max size
    defaultAspectRatio: '1:1',
    defaultResolution: '1K',
    defaultChatTemperature: 0.5,

    debugMode: false,

    chatSystemPrompt: 'You are a helpful AI assistant embedded in an Obsidian Canvas. Answer concisely and use Markdown formatting.',
    nodeSystemPrompt: '',  // Empty means use default built-in prompt
    imageSystemPrompt: 'Role: A Professional Image Creator. Use the following references for image creation.',

    nodeDefaultColor: '6',  // Default to color 6

    chatPresets: [],
    imagePresets: [],
    nodePresets: [],
    defaultNodeTemperature: 0.5,

    imageGenerationTimeout: 120,  // Default 120 seconds

    // Quick switch models
    quickSwitchTextModels: [],
    quickSwitchImageModels: [],
    paletteTextModel: '',
    paletteImageModel: '',
    paletteNodeModel: ''
};


// ========== Prompt Preset Interface ==========
export interface PromptPreset {
    id: string;      // UUID
    name: string;    // Display name
    prompt: string;  // Prompt content
}

// ========== Floating Palette Mode ==========
type PaletteMode = 'chat' | 'image' | 'node';

// AI Button ID constant for popup menu
const AI_SPARKLES_BUTTON_ID = 'canvas-ai-sparkles';

// ========== Input Modal for Preset Names ==========
class InputModal extends Modal {
    private result: string = '';
    private onSubmit: (result: string) => void;
    private title: string;
    private placeholder: string;
    private defaultValue: string;

    constructor(app: App, title: string, placeholder: string, defaultValue: string, onSubmit: (result: string) => void) {
        super(app);
        this.title = title;
        this.placeholder = placeholder;
        this.defaultValue = defaultValue;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h3', { text: this.title });

        const inputEl = contentEl.createEl('input', {
            type: 'text',
            placeholder: this.placeholder,
            value: this.defaultValue
        });
        inputEl.addClass('canvas-ai-modal-input');
        inputEl.style.width = '100%';
        inputEl.style.marginBottom = '16px';
        this.result = this.defaultValue;

        inputEl.addEventListener('input', (e) => {
            this.result = (e.target as HTMLInputElement).value;
        });

        inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.close();
                if (this.result.trim()) {
                    this.onSubmit(this.result.trim());
                }
            }
        });

        const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });

        const cancelBtn = buttonContainer.createEl('button', { text: t('Cancel') });
        cancelBtn.addEventListener('click', () => this.close());

        const submitBtn = buttonContainer.createEl('button', { text: t('OK'), cls: 'mod-cta' });
        submitBtn.addEventListener('click', () => {
            this.close();
            if (this.result.trim()) {
                this.onSubmit(this.result.trim());
            }
        });

        // Focus input
        setTimeout(() => inputEl.focus(), 50);
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

// ========== Confirm Modal for Delete ==========
class ConfirmModal extends Modal {
    private onConfirm: () => void;
    private message: string;

    constructor(app: App, message: string, onConfirm: () => void) {
        super(app);
        this.message = message;
        this.onConfirm = onConfirm;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h3', { text: t('Confirm Delete') });
        contentEl.createEl('p', { text: this.message });

        const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });

        const cancelBtn = buttonContainer.createEl('button', { text: t('Cancel') });
        cancelBtn.addEventListener('click', () => this.close());

        const deleteBtn = buttonContainer.createEl('button', { text: t('Delete'), cls: 'mod-warning' });
        deleteBtn.addEventListener('click', () => {
            this.close();
            this.onConfirm();
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

// ========== Floating Palette Component ==========
class FloatingPalette {
    private containerEl: HTMLElement;
    private currentMode: PaletteMode = 'chat';
    private promptInput: HTMLTextAreaElement;
    private isVisible: boolean = false;
    private currentParent: HTMLElement | null = null;
    private onClose: (() => void) | null = null;
    private onDebug: ((mode: PaletteMode) => void) | null = null;
    private onGenerate: ((prompt: string, mode: PaletteMode) => Promise<void>) | null = null;
    private onSettingsChange: ((key: 'aspectRatio' | 'resolution' | 'chatTemperature' | 'nodeTemperature', value: string | number) => void) | null = null;
    private apiManager: ApiManager;
    private pendingTaskCount: number = 0;
    // Track text node count for generate button state
    private currentTextCount: number = 0;
    // Image generation options (no model selection - always use Pro)
    private imageAspectRatio: string = '1:1';
    private imageResolution: string = '1K';
    private chatTemperature: number = 0.5;
    private nodeTemperature: number = 0.5;

    // DOM references for image options
    private imageOptionsEl: HTMLElement | null = null;
    private chatOptionsEl: HTMLElement | null = null;
    private ratioSelect: HTMLSelectElement | null = null;
    private resolutionSelect: HTMLSelectElement | null = null;
    private tempInput: HTMLInputElement | null = null;
    private nodeTempInput: HTMLInputElement | null = null;
    private nodeOptionsEl: HTMLElement | null = null;
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
    private onPresetChange: ((presets: PromptPreset[], mode: PaletteMode) => void) | null = null;
    private app: App;
    private scope: Scope;

    // Quick switch model selection
    private textModelSelectEl: HTMLSelectElement | null = null;
    private imageModelSelectEl: HTMLSelectElement | null = null;
    private nodeModelSelectEl: HTMLSelectElement | null = null;
    private quickSwitchTextModels: QuickSwitchModel[] = [];
    private quickSwitchImageModels: QuickSwitchModel[] = [];
    private selectedTextModel: string = '';  // Format: "provider|modelId"
    private selectedImageModel: string = '';
    private selectedNodeModel: string = '';
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
    setOnSettingsChange(callback: (key: 'aspectRatio' | 'resolution' | 'chatTemperature', value: string | number) => void): void {
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
     * Initialize chat options from settings
     */
    initChatOptions(temperature: number): void {
        this.chatTemperature = temperature;
        if (this.tempInput) {
            this.tempInput.value = String(temperature);
        }
    }

    /**
     * Set debug mode visibility for the Debug button
     */
    setDebugMode(enabled: boolean): void {
        if (this.debugBtnEl) {
            this.debugBtnEl.style.display = enabled ? 'block' : 'none';
        }
    }

    /**
     * Set version info text dynamically
     */
    setVersion(version: string): void {
    }


    /**
     * 创建面板 DOM 结构
     */
    private createPaletteDOM(): HTMLElement {
        const container = document.createElement('div');
        container.addClass('canvas-ai-palette');
        container.style.display = 'none';

        // 阻止点击事件冒泡，避免失去 Canvas 选中状态
        container.addEventListener('mousedown', (e) => e.stopPropagation());
        container.addEventListener('click', (e) => e.stopPropagation());

        // 阻止所有键盘事件冒泡，确保输入框操作不会影响 Canvas 节点
        // Canvas 可能在 capture 阶段监听，因此使用 capture: true


        container.innerHTML = `
            <div class="canvas-ai-palette-header">
                <div class="canvas-ai-tabs">
                    <button class="canvas-ai-tab active" data-mode="chat">${t('Text')}</button>
                    <button class="canvas-ai-tab" data-mode="image">${t('Image')}</button>
                    <button class="canvas-ai-tab" data-mode="node">${t('Node')}</button>
                </div>
                <button class="canvas-ai-close-btn">×</button>
            </div>
            <div class="canvas-ai-palette-body">
                <div class="canvas-ai-preset-row">
                    <select class="canvas-ai-preset-select dropdown">
                        <option value="">${t('Select prompt preset')}</option>
                    </select>
                    <div class="canvas-ai-preset-actions">
                        <button class="canvas-ai-preset-btn" data-action="add" title="${t('New Preset')}"></button>
                        <button class="canvas-ai-preset-btn" data-action="delete" title="${t('Delete')}"></button>
                        <button class="canvas-ai-preset-btn" data-action="save" title="${t('Save')}"></button>
                        <button class="canvas-ai-preset-btn" data-action="rename" title="${t('Rename Preset')}"></button>
                    </div>
                </div>
                <textarea 
                    class="canvas-ai-prompt-input" 
                    placeholder="${t('Enter instructions')}"
                    rows="4"
                ></textarea>
                <div class="canvas-ai-image-options" style="display: none;">
                    <div class="canvas-ai-option-row">
                        <span class="canvas-ai-option-group">
                            <label>${t('Resolution')}</label>
                            <select class="canvas-ai-resolution-select dropdown">
                                <option value="1K">1K</option>
                                <option value="2K">2K</option>
                                <option value="4K">4K</option>
                            </select>
                        </span>
                        <span class="canvas-ai-option-group">
                            <label>${t('Ratio')}</label>
                            <select class="canvas-ai-ratio-select dropdown">
                                <option value="1:1">1:1</option>
                                <option value="2:3">2:3</option>
                                <option value="3:2">3:2</option>
                                <option value="3:4">3:4</option>
                                <option value="4:3">4:3</option>
                                <option value="4:5">4:5</option>
                                <option value="5:4">5:4</option>
                                <option value="9:16">9:16</option>
                                <option value="16:9">16:9</option>
                                <option value="21:9">21:9</option>
                            </select>
                        </span>
                    </div>
                    <div class="canvas-ai-option-row canvas-ai-image-model-select-row" style="display: none;">
                        <span class="canvas-ai-option-group">
                            <label>${t('Palette Model')}</label>
                            <select class="canvas-ai-image-model-select dropdown"></select>
                        </span>
                    </div>
                </div>
                <div class="canvas-ai-chat-options">
                    <div class="canvas-ai-option-row">
                        <span class="canvas-ai-option-group">
                            <label>${t('Temperature')}</label>
                            <input type="number" class="canvas-ai-temp-input" min="0" max="2" step="0.1" value="0.5">
                        </span>
                    </div>
                    <div class="canvas-ai-option-row canvas-ai-model-select-row" style="display: none;">
                        <span class="canvas-ai-option-group">
                            <label>${t('Palette Model')}</label>
                            <select class="canvas-ai-text-model-select dropdown"></select>
                        </span>
                    </div>
                </div>
                <div class="canvas-ai-node-options" style="display: none;">
                    <div class="canvas-ai-option-row">
                        <span class="canvas-ai-option-group">
                            <label>${t('Temperature')}</label>
                            <input type="number" class="canvas-ai-node-temp-input" min="0" max="2" step="0.1" value="0.5">
                        </span>
                    </div>
                    <div class="canvas-ai-option-row canvas-ai-node-model-select-row" style="display: none;">
                        <span class="canvas-ai-option-group">
                            <label>${t('Palette Model')}</label>
                            <select class="canvas-ai-node-model-select dropdown"></select>
                        </span>
                    </div>
                </div>
                
                <!-- Action Row (Moved from Footer) -->
                <div class="canvas-ai-action-row">
                    <button class="canvas-ai-generate-btn">${t('Generate')}</button>
                    <button class="canvas-ai-debug-btn" style="display: none;">${t('Debug')}</button>
                </div>
            </div>
            <div class="canvas-ai-palette-footer">
                <span class="canvas-ai-context-preview"></span>
            </div>
        `;

        // Get version info element - REMOVED

        // Get image options DOM references

        // Get image options DOM references
        this.imageOptionsEl = container.querySelector('.canvas-ai-image-options');
        this.chatOptionsEl = container.querySelector('.canvas-ai-chat-options');
        this.nodeOptionsEl = container.querySelector('.canvas-ai-node-options');
        this.ratioSelect = container.querySelector('.canvas-ai-ratio-select');
        this.resolutionSelect = container.querySelector('.canvas-ai-resolution-select');
        this.tempInput = container.querySelector('.canvas-ai-temp-input');
        this.nodeTempInput = container.querySelector('.canvas-ai-node-temp-input');

        // Get model select DOM references
        this.textModelSelectEl = container.querySelector('.canvas-ai-text-model-select');
        this.imageModelSelectEl = container.querySelector('.canvas-ai-image-model-select');
        this.nodeModelSelectEl = container.querySelector('.canvas-ai-node-model-select');

        // Bind text model select change events
        this.textModelSelectEl?.addEventListener('change', () => {
            const value = this.textModelSelectEl!.value;
            this.selectedTextModel = value;
            this.onModelChange?.('chat', value);
        });

        // Bind image model select change events
        this.imageModelSelectEl?.addEventListener('change', () => {
            const value = this.imageModelSelectEl!.value;
            this.selectedImageModel = value;
            this.onModelChange?.('image', value);
        });

        // Bind node model select change events
        this.nodeModelSelectEl?.addEventListener('change', () => {
            const value = this.nodeModelSelectEl!.value;
            this.selectedNodeModel = value;
            this.onModelChange?.('node', value);
        });

        // Bind temperature input events
        this.tempInput?.addEventListener('input', () => {
            const val = parseFloat(this.tempInput!.value);
            if (!isNaN(val)) {
                this.chatTemperature = val; // Update internal state immediately
            }
        });

        this.tempInput?.addEventListener('change', () => {
            const val = parseFloat(this.tempInput!.value);
            if (!isNaN(val)) {
                const clampedVal = Math.max(0, Math.min(2, val));
                this.chatTemperature = clampedVal;
                this.tempInput!.value = String(clampedVal); // Auto-correct display
                this.onSettingsChange?.('chatTemperature', clampedVal);
            } else {
                // Revert to current valid value if NaN
                this.tempInput!.value = String(this.chatTemperature);
            }
        });

        // Bind node temperature input events
        this.nodeTempInput?.addEventListener('input', () => {
            const val = parseFloat(this.nodeTempInput!.value);
            if (!isNaN(val)) {
                this.nodeTemperature = val;
            }
        });

        this.nodeTempInput?.addEventListener('change', () => {
            const val = parseFloat(this.nodeTempInput!.value);
            if (!isNaN(val)) {
                const clampedVal = Math.max(0, Math.min(2, val));
                this.nodeTemperature = clampedVal;
                this.nodeTempInput!.value = String(clampedVal);
                this.onSettingsChange?.('nodeTemperature', clampedVal);
            } else {
                this.nodeTempInput!.value = String(this.nodeTemperature);
            }
        });

        // Get preset DOM references
        this.presetSelect = container.querySelector('.canvas-ai-preset-select');
        this.presetAddBtn = container.querySelector('.canvas-ai-preset-btn[data-action="add"]');
        this.presetDeleteBtn = container.querySelector('.canvas-ai-preset-btn[data-action="delete"]');
        this.presetSaveBtn = container.querySelector('.canvas-ai-preset-btn[data-action="save"]');
        this.presetRenameBtn = container.querySelector('.canvas-ai-preset-btn[data-action="rename"]');

        // Set icons for preset buttons using Lucide icons
        if (this.presetAddBtn) setIcon(this.presetAddBtn, 'circle-plus');
        if (this.presetDeleteBtn) setIcon(this.presetDeleteBtn, 'circle-x');
        if (this.presetSaveBtn) setIcon(this.presetSaveBtn, 'save');
        if (this.presetRenameBtn) setIcon(this.presetRenameBtn, 'book-a');

        // Bind preset select change
        this.presetSelect?.addEventListener('change', () => {
            const selectedId = this.presetSelect!.value;
            if (selectedId) {
                const presets = this.currentMode === 'chat'
                    ? this.chatPresets
                    : this.currentMode === 'image'
                        ? this.imagePresets
                        : this.nodePresets;
                const preset = presets.find(p => p.id === selectedId);
                if (preset) {
                    this.promptInput.value = preset.prompt;
                }
            }
        });

        // Bind preset action buttons
        this.presetAddBtn?.addEventListener('click', () => this.handlePresetAdd());
        this.presetDeleteBtn?.addEventListener('click', () => this.handlePresetDelete());
        this.presetSaveBtn?.addEventListener('click', () => this.handlePresetSave());
        this.presetRenameBtn?.addEventListener('click', () => this.handlePresetRename());

        // Bind ratio select change
        this.ratioSelect?.addEventListener('change', () => {
            this.imageAspectRatio = this.ratioSelect!.value;
            this.onSettingsChange?.('aspectRatio', this.imageAspectRatio);
        });

        // Bind resolution select change
        this.resolutionSelect?.addEventListener('change', () => {
            this.imageResolution = this.resolutionSelect!.value;
            this.onSettingsChange?.('resolution', this.imageResolution);
        });

        // 绑定 Tab 切换事件
        const tabs = container.querySelectorAll('.canvas-ai-tab');
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

        // 绑定关闭按钮
        const closeBtn = container.querySelector('.canvas-ai-close-btn');
        closeBtn?.addEventListener('click', () => {
            this.hide();
            this.onClose?.();
        });

        // 绑定 Debug 按钮
        this.debugBtnEl = container.querySelector('.canvas-ai-debug-btn') as HTMLButtonElement;
        this.debugBtnEl?.addEventListener('click', () => {
            this.onDebug?.(this.currentMode);
        });

        // 绑定生成按钮
        const generateBtn = container.querySelector('.canvas-ai-generate-btn');
        generateBtn?.addEventListener('click', () => this.handleGenerate());

        // Prevent keyboard events from bubbling to Canvas when textarea is focused
        const promptInput = container.querySelector('.canvas-ai-prompt-input');
        if (promptInput) {
            const stopPropagation = (e: Event) => e.stopPropagation();
            // Prevent keyboard events from bubbling to Canvas when textarea is focused
            // Note: Ctrl+Enter is handled by the Scope API registered in constructor
            promptInput.addEventListener('keydown', stopPropagation, { capture: true });
            promptInput.addEventListener('keyup', stopPropagation);
            promptInput.addEventListener('keypress', stopPropagation);
        }

        return container;
    }

    /**
     * Show/hide options based on current mode
     */
    private updateOptionsVisibility(): void {
        if (this.imageOptionsEl) {
            this.imageOptionsEl.style.display = this.currentMode === 'image' ? 'flex' : 'none';
        }
        if (this.chatOptionsEl) {
            this.chatOptionsEl.style.display = this.currentMode === 'chat' ? 'flex' : 'none';
        }
        if (this.nodeOptionsEl) {
            this.nodeOptionsEl.style.display = this.currentMode === 'node' ? 'flex' : 'none';
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
                : this.nodePresets;

        // Clear existing options except the default
        this.presetSelect.innerHTML = `<option value="">${t('Select prompt preset')}</option>`;

        // Add preset options
        presets.forEach(preset => {
            const option = document.createElement('option');
            option.value = preset.id;
            option.textContent = preset.name;
            this.presetSelect!.appendChild(option);
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
                } else {
                    this.nodePresets.push(newPreset);
                    this.onPresetChange?.(this.nodePresets, 'node');
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
                : this.nodePresets;
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
                } else {
                    this.nodePresets = this.nodePresets.filter(p => p.id !== selectedId);
                    this.onPresetChange?.(this.nodePresets, 'node');
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
                : this.nodePresets;
        const preset = presets.find(p => p.id === selectedId);
        if (!preset) return;

        preset.prompt = this.promptInput.value;

        if (this.currentMode === 'chat') {
            this.onPresetChange?.(this.chatPresets, 'chat');
        } else if (this.currentMode === 'image') {
            this.onPresetChange?.(this.imagePresets, 'image');
        } else {
            this.onPresetChange?.(this.nodePresets, 'node');
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
                : this.nodePresets;
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
                } else {
                    this.onPresetChange?.(this.nodePresets, 'node');
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
    initPresets(chatPresets: PromptPreset[], imagePresets: PromptPreset[], nodePresets: PromptPreset[] = []): void {
        this.chatPresets = [...chatPresets];
        this.imagePresets = [...imagePresets];
        this.nodePresets = [...nodePresets];
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
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    }

    /**
     * 更新输入框提示文本
     */
    private updatePlaceholder(): void {
        if (this.currentMode === 'chat') {
            this.promptInput.placeholder = t('Enter instructions');
        } else if (this.currentMode === 'image') {
            this.promptInput.placeholder = t('Describe the image');
        } else {
            this.promptInput.placeholder = t('Describe structure');
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

        // Fool-proof: disable when no text content and no prompt
        const hasPrompt = this.promptInput.value.trim().length > 0;
        const hasTextContent = this.currentTextCount > 0;
        const shouldDisable = !hasPrompt && !hasTextContent && this.pendingTaskCount === 0;

        generateBtn.disabled = shouldDisable;
        if (shouldDisable) {
            generateBtn.addClass('disabled');
        } else {
            generateBtn.removeClass('disabled');
        }
    }

    /**
     * 处理生成按钮点击
     */
    private async handleGenerate(): Promise<void> {
        const prompt = this.promptInput.value.trim();
        console.log('Canvas AI: Generate clicked');
        console.log('Mode:', this.currentMode);
        console.log('Prompt:', prompt || '(empty - will use fallback)');

        // Note: Empty prompt is now allowed - IntentResolver will handle fallback
        // No longer blocking - multiple tasks can run concurrently

        // Check if API is configured
        if (!this.apiManager.isConfigured()) {
            console.error('Canvas AI: API Key not configured. Please set it in plugin settings.');
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

            // Fire-and-forget: don't await, let task run in background
            this.onGenerate(currentPrompt, currentMode)
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
     * Get current chat options
     */
    getChatOptions(): { temperature: number } {
        return {
            temperature: this.chatTemperature
        };
    }

    /**
     * Get current node mode options
     */
    getNodeOptions(): { temperature: number } {
        return {
            temperature: this.nodeTemperature
        };
    }

    /**
     * Initialize node options from settings
     */
    initNodeOptions(temperature: number): void {
        this.nodeTemperature = temperature;
        if (this.nodeTempInput) {
            this.nodeTempInput.value = String(temperature);
        }
    }

    /**
     * Initialize quick switch models from settings
     */
    initQuickSwitchModels(
        textModels: QuickSwitchModel[],
        imageModels: QuickSwitchModel[],
        selectedTextModel: string,
        selectedImageModel: string,
        selectedNodeModel: string
    ): void {
        this.quickSwitchTextModels = textModels;
        this.quickSwitchImageModels = imageModels;
        this.selectedTextModel = selectedTextModel;
        this.selectedImageModel = selectedImageModel;
        this.selectedNodeModel = selectedNodeModel;
        this.updateModelSelects();
    }

    /**
     * Update model select dropdowns based on current mode
     */
    updateModelSelects(): void {
        const hasTextModels = this.quickSwitchTextModels.length > 0;
        const hasImageModels = this.quickSwitchImageModels.length > 0;

        // Helper to format provider name with proper capitalization
        const formatProviderName = (provider: string): string => {
            switch (provider.toLowerCase()) {
                case 'openrouter': return 'OpenRouter';
                case 'yunwu': return 'Yunwu';
                case 'gemini': return 'Gemini';
                case 'gptgod': return 'GPTGod';
                default: return provider.charAt(0).toUpperCase() + provider.slice(1);
            }
        };

        // Helper to populate a select with models
        const populateSelect = (
            selectEl: HTMLSelectElement | null,
            models: QuickSwitchModel[],
            selectedValue: string
        ): string => {
            if (!selectEl) return selectedValue;
            selectEl.innerHTML = '';

            // Add models from quick switch list (no empty default option)
            // Format: "ModelName | Provider"
            for (const model of models) {
                const opt = document.createElement('option');
                opt.value = `${model.provider}|${model.modelId}`;
                opt.textContent = `${model.displayName} | ${formatProviderName(model.provider)}`;
                selectEl.appendChild(opt);
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
            textRow.style.display = hasTextModels ? 'flex' : 'none';
        }

        // Update node model select (node mode uses same text model list)
        this.selectedNodeModel = populateSelect(this.nodeModelSelectEl, this.quickSwitchTextModels, this.selectedNodeModel);
        const nodeRow = this.nodeModelSelectEl?.closest('.canvas-ai-node-model-select-row') as HTMLElement;
        if (nodeRow) {
            nodeRow.style.display = hasTextModels ? 'flex' : 'none';
        }

        // Update image model select
        this.selectedImageModel = populateSelect(this.imageModelSelectEl, this.quickSwitchImageModels, this.selectedImageModel);
        const imageRow = this.imageModelSelectEl?.closest('.canvas-ai-image-model-select-row') as HTMLElement;
        if (imageRow) {
            imageRow.style.display = hasImageModels ? 'flex' : 'none';
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
            this.containerEl.style.display = 'none';
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
            this.containerEl.style.display = 'flex';
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
        this.containerEl.style.display = 'none';
        this.isVisible = false;
    }

    /**
     * 获取当前是否可见
     */
    get visible(): boolean {
        return this.isVisible;
    }

    /**
     * 清理 DOM
     */
    destroy(): void {
        this.containerEl.remove();
    }
}

// ========== Plugin Main Class ==========
export default class CanvasAIPlugin extends Plugin {
    settings: CanvasAISettings;

    public floatingPalette: FloatingPalette | null = null;
    private lastSelectionSize: number = 0;
    private lastSelectedIds: Set<string> = new Set();
    private hideTimer: number | null = null;
    public apiManager: ApiManager | null = null;
    // Track active ghost nodes to prevent race conditions during concurrent image generations
    private activeGhostNodeIds: Set<string> = new Set();

    async onload() {
        console.log('Canvas AI: Plugin loading...');

        await this.loadSettings();

        // Migration: Move legacy settings to OpenRouter settings if needed
        if (this.settings.textModel && !this.settings.openRouterTextModel) {
            this.settings.openRouterTextModel = this.settings.textModel;
            this.settings.textModel = undefined; // Clear legacy
        }
        if (this.settings.imageModel && !this.settings.openRouterImageModel) {
            this.settings.openRouterImageModel = this.settings.imageModel;
            this.settings.imageModel = undefined;
        }
        if (this.settings.useCustomTextModel !== undefined && this.settings.openRouterUseCustomTextModel === undefined) {
            // @ts-ignore
            this.settings.openRouterUseCustomTextModel = this.settings.useCustomTextModel;
            this.settings.useCustomTextModel = undefined;
        }
        if (this.settings.useCustomImageModel !== undefined && this.settings.openRouterUseCustomImageModel === undefined) {
            // @ts-ignore
            this.settings.openRouterUseCustomImageModel = this.settings.useCustomImageModel;
            this.settings.useCustomImageModel = undefined;
        }
        await this.saveSettings();

        // Register settings tab
        this.addSettingTab(new CanvasAISettingTab(this.app, this));

        // 初始化悬浮组件
        this.initFloatingComponents();

        // 注册 Canvas 选中状态监听
        this.registerCanvasSelectionListener();

        // Register Canvas utility hotkeys
        this.registerCanvasUtilities();

        console.log('Canvas AI: Plugin loaded');
    }

    onunload() {
        console.log('Canvas AI: Plugin unloading...');

        // 清理 DOM 组件
        this.floatingPalette?.destroy();

        console.log('Canvas AI: Plugin unloaded');
    }

    /**
     * 初始化悬浮组件
     */
    private initFloatingComponents(): void {
        // Initialize API Manager
        this.apiManager = new ApiManager(this.settings);

        this.floatingPalette = new FloatingPalette(this.app, this.apiManager, (mode) => {
            this.debugSelectedNodes(mode);
        });

        // Set up generate callback for Ghost Node creation
        this.floatingPalette.setOnGenerate(async (prompt: string, mode: PaletteMode) => {
            await this.handleGeneration(prompt, mode);
        });

        // Set up settings change callback for persisting image options
        this.floatingPalette.setOnSettingsChange((key, value) => {
            if (key === 'aspectRatio') {
                this.settings.defaultAspectRatio = value as string;
            } else if (key === 'resolution') {
                this.settings.defaultResolution = value as string;
            } else if (key === 'chatTemperature') {
                this.settings.defaultChatTemperature = value as number;
            } else if (key === 'nodeTemperature') {
                this.settings.defaultNodeTemperature = value as number;
            }
            this.saveSettings();
        });

        // Set up preset change callback for persisting presets
        this.floatingPalette.setOnPresetChange((presets, mode) => {
            if (mode === 'chat') {
                this.settings.chatPresets = presets;
            } else if (mode === 'image') {
                this.settings.imagePresets = presets;
            } else {
                this.settings.nodePresets = presets;
            }
            this.saveSettings();
        });

        // Initialize palette with saved settings
        this.floatingPalette.initImageOptions(
            this.settings.defaultAspectRatio,
            this.settings.defaultResolution
        );

        this.floatingPalette.initChatOptions(
            this.settings.defaultChatTemperature
        );

        this.floatingPalette.initNodeOptions(
            this.settings.defaultNodeTemperature
        );

        // Initialize presets from saved settings
        this.floatingPalette.initPresets(
            this.settings.chatPresets || [],
            this.settings.imagePresets || [],
            this.settings.nodePresets || []
        );

        // Initialize debug mode from settings
        this.floatingPalette.setDebugMode(this.settings.debugMode);

        // Initialize quick switch models from settings
        this.floatingPalette.initQuickSwitchModels(
            this.settings.quickSwitchTextModels || [],
            this.settings.quickSwitchImageModels || [],
            this.settings.paletteTextModel || '',
            this.settings.paletteImageModel || '',
            this.settings.paletteNodeModel || ''
        );

        // Set up model change callback for persisting selected models
        this.floatingPalette.setOnModelChange((mode, modelKey) => {
            if (mode === 'chat') {
                this.settings.paletteTextModel = modelKey;
            } else if (mode === 'image') {
                this.settings.paletteImageModel = modelKey;
            } else if (mode === 'node') {
                this.settings.paletteNodeModel = modelKey;
            }
            this.saveSettings();
        });

        // Set version from manifest
        this.floatingPalette.setVersion(this.manifest.version);
    }

    /**
     * Handle generation with Ghost Node
     * Uses IntentResolver for intelligent intent parsing (design_doc_v2.md 3.2-3.6)
     */
    private async handleGeneration(userPrompt: string, mode: PaletteMode): Promise<void> {
        const canvasView = this.app.workspace.getActiveViewOfType(ItemView);
        if (!canvasView || canvasView.getViewType() !== 'canvas') {
            console.error('Canvas AI: Not in canvas view');
            return;
        }

        const canvas = (canvasView as any).canvas as Canvas | undefined;
        if (!canvas) {
            console.error('Canvas AI: Canvas not found');
            return;
        }

        const selection = canvas.selection;

        // ========== Temporary settings override for quick switch model ==========
        const selectedModel = this.floatingPalette?.getSelectedModel(mode) || '';
        let originalProvider: ApiProvider | null = null;
        let originalTextModel: string | null = null;
        let originalImageModel: string | null = null;

        if (selectedModel) {
            const [provider, modelId] = selectedModel.split('|');
            if (provider && modelId) {
                // Backup original settings
                originalProvider = this.settings.apiProvider;
                originalTextModel = this.getCurrentTextModel();
                originalImageModel = this.getCurrentImageModel();

                // Override settings temporarily
                this.settings.apiProvider = provider as ApiProvider;
                this.setCurrentTextModel(modelId);
                this.setCurrentImageModel(modelId);

                // Reinitialize API manager with new settings
                this.apiManager = new ApiManager(this.settings);

                console.log(`Canvas AI: Quick switch to ${provider}/${modelId}`);
            }
        }

        // Restoration function to call in finally block
        const restoreSettings = () => {
            if (originalProvider !== null) {
                this.settings.apiProvider = originalProvider;
                if (originalTextModel !== null) {
                    this.setCurrentTextModel(originalTextModel);
                }
                if (originalImageModel !== null) {
                    this.setCurrentImageModel(originalImageModel);
                }
                // Reinitialize API manager with original settings
                this.apiManager = new ApiManager(this.settings);
                console.log('Canvas AI: Restored original settings');
            }
        };

        // ========== Use IntentResolver for intelligent parsing ==========
        let intent: ResolvedIntent;
        try {
            intent = await IntentResolver.resolve(
                this.app,
                canvas,
                selection || new Set(),
                userPrompt,
                mode,
                this.settings
            );
        } catch (e) {
            console.error('Canvas AI: Intent resolution failed:', e);
            return;
        }

        // Check if generation is possible
        if (!intent.canGenerate) {
            console.log('Canvas AI: Nothing to generate (no images, no text, no prompt)');
            return;
        }

        // Log warnings
        if (intent.warnings.length > 0) {
            console.warn('Canvas AI: Warnings:', intent.warnings);
        }

        // ========== Calculate position for ghost node (right of selection) ==========
        let nodeX = 100, nodeY = 100;
        if (selection && selection.size > 0) {
            const bbox = this.getSelectionBBox(selection);
            if (bbox) {
                nodeX = bbox.maxX + 50;
                nodeY = bbox.minY;
            }
        }

        // Create Ghost Node
        const ghostNode = this.createGhostNode(canvas, nodeX, nodeY);
        console.log('Canvas AI: Ghost Node created:', ghostNode.id);

        try {
            let response: string;

            if (mode === 'chat') {
                // Chat Mode - use context and instruction
                let systemPrompt = this.settings.chatSystemPrompt || 'You are a helpful AI assistant embedded in an Obsidian Canvas. Answer concisely and use Markdown formatting.';

                if (intent.contextText) {
                    systemPrompt += `\n\n---\nThe user has selected the following content from their canvas:\n\n${intent.contextText}\n\n---\nBased on this context, respond to the user's request.`;
                }

                // Get chat options from palette
                const chatOptions = this.floatingPalette!.getChatOptions();

                console.log('Canvas AI: Sending chat request with context');

                // Build media list for multimodal request (images + PDFs)
                const mediaList: { base64: string, mimeType: string, type: 'image' | 'pdf' }[] = [];

                // Add images
                for (const img of intent.images) {
                    mediaList.push({
                        base64: img.base64,
                        mimeType: img.mimeType,
                        type: 'image'
                    });
                }

                // Add PDFs from nodes
                for (const node of intent.nodes) {
                    if (node.isPdf && node.pdfBase64) {
                        mediaList.push({
                            base64: node.pdfBase64,
                            mimeType: 'application/pdf',
                            type: 'pdf'
                        });
                    }
                }

                if (mediaList.length > 0) {
                    response = await this.apiManager!.multimodalChat(
                        intent.instruction,
                        mediaList,
                        systemPrompt,
                        chatOptions.temperature
                    );
                } else {
                    response = await this.apiManager!.chatCompletion(intent.instruction, systemPrompt, chatOptions.temperature);
                }
                console.log('Canvas AI: API Response received');
                this.updateGhostNode(ghostNode, response, false);

            } else if (mode === 'image') {
                // Image Mode - use new generateImageWithRoles
                // Get user-selected image options from palette
                const imageOptions = this.floatingPalette!.getImageOptions();
                console.log('Canvas AI: Sending image request with roles');
                console.log('Canvas AI: Instruction:', intent.instruction);
                console.log('Canvas AI: Images with roles:', intent.images.map(i => i.role));
                console.log('Canvas AI: Image options:', imageOptions);

                const base64Image = await this.apiManager!.generateImageWithRoles(
                    intent.instruction,
                    intent.images,
                    intent.contextText,
                    imageOptions.aspectRatio,
                    imageOptions.resolution
                );

                // Update Ghost Node to show saving status
                this.updateGhostNode(ghostNode, '💾 Saving image...', false, true);

                // Save to Vault
                const savedFile = await this.saveImageToVault(base64Image, intent.instruction);
                console.log('Canvas AI: Image saved to', savedFile.path);

                // Replace Ghost Node with Image Node
                this.replaceGhostWithImageNode(canvas, ghostNode, savedFile);

            } else {
                // Node Mode - Generate Canvas JSON structure
                const nodeOptions = this.floatingPalette!.getNodeOptions();
                console.log('Canvas AI: Sending node structure request');
                console.log('Canvas AI: Context text length:', intent.contextText.length);
                console.log('Canvas AI: Images count:', intent.images.length);

                // Build node mode system prompt
                const nodeSystemPrompt = this.getNodeModeSystemPrompt();

                let fullInstruction = intent.instruction;
                if (intent.contextText) {
                    // Use clear markers to separate context (content to process) from instruction (command)
                    // The instruction is a meta-command, should NOT appear in generated node content
                    fullInstruction = `[SOURCE_CONTENT]
${intent.contextText}
[/SOURCE_CONTENT]

[USER_INSTRUCTION]
${intent.instruction}
[/USER_INSTRUCTION]`;
                }

                // Build media list for multimodal request (images + PDFs) - same pattern as chat mode
                const mediaList: { base64: string, mimeType: string, type: 'image' | 'pdf' }[] = [];

                // Add images
                for (const img of intent.images) {
                    mediaList.push({
                        base64: img.base64,
                        mimeType: img.mimeType,
                        type: 'image'
                    });
                }

                // Add PDFs from nodes
                for (const node of intent.nodes) {
                    if (node.isPdf && node.pdfBase64) {
                        mediaList.push({
                            base64: node.pdfBase64,
                            mimeType: 'application/pdf',
                            type: 'pdf'
                        });
                    }
                }

                if (mediaList.length > 0) {
                    console.log('Canvas AI: Sending node request with', mediaList.length, 'media items');
                    response = await this.apiManager!.multimodalChat(
                        fullInstruction,
                        mediaList,
                        nodeSystemPrompt,
                        nodeOptions.temperature
                    );
                } else {
                    response = await this.apiManager!.chatCompletion(
                        fullInstruction,
                        nodeSystemPrompt,
                        nodeOptions.temperature
                    );
                }

                console.log('Canvas AI: Node structure response received');
                if (this.settings.debugMode) {
                    console.log('Canvas AI: Raw node response:', response);
                }

                try {
                    // Extract and parse JSON from response
                    let canvasData = extractCanvasJSON(response);

                    // Sanitize: remove empty nodes, orphan nodes, and invalid edges
                    const sanitizeResult = sanitizeCanvasData(canvasData, true);
                    canvasData = sanitizeResult.data;
                    if (sanitizeResult.stats.removedEmptyNodes > 0 || sanitizeResult.stats.removedOrphanNodes > 0 || sanitizeResult.stats.removedInvalidEdges > 0 || sanitizeResult.stats.fixedMalformedGroups > 0) {
                        console.log(`Canvas AI: Sanitized - removed ${sanitizeResult.stats.removedEmptyNodes} empty nodes, ${sanitizeResult.stats.removedOrphanNodes} orphan nodes, ${sanitizeResult.stats.removedInvalidEdges} invalid edges, fixed ${sanitizeResult.stats.fixedMalformedGroups} malformed groups`);
                    }

                    // Regenerate IDs to avoid collision with existing canvas elements
                    canvasData = regenerateIds(canvasData);

                    // Get ghost node center for coordinate remapping
                    const ghostCenter = {
                        x: ghostNode.x + ghostNode.width / 2,
                        y: ghostNode.y + ghostNode.height / 2
                    };
                    canvasData = remapCoordinates(canvasData, ghostCenter);

                    // Optimize layout: adjust sizes based on text and spread overlapping nodes
                    canvasData = optimizeLayout(canvasData);

                    // Replace ghost node with generated structure by modifying canvas file directly
                    await this.replaceGhostWithCanvasData(canvas, ghostNode, canvasData);

                    console.log(`Canvas AI: Created ${canvasData.nodes.length} nodes and ${canvasData.edges.length} edges`);

                } catch (parseError: any) {
                    console.error('Canvas AI: JSON parse error:', parseError);
                    this.updateGhostNode(ghostNode, `❗ ${t('Invalid JSON structure')}: ${parseError.message}`, true);
                }
            }
        } catch (error: any) {
            console.error('Canvas AI: API Error:', error.message || error);
            this.updateGhostNode(ghostNode, `❗ Error: ${error.message || 'Unknown error'}`, true);
        } finally {
            // Restore original settings if they were overridden
            restoreSettings();
        }
    }

    /**
     * Get Node Mode system prompt for structured JSON output
     */
    private getNodeModeSystemPrompt(): string {
        // If user has set a custom prompt, use it
        if (this.settings.nodeSystemPrompt && this.settings.nodeSystemPrompt.trim()) {
            return this.settings.nodeSystemPrompt;
        }

        // Default built-in prompt
        return `你是一个专业的 Obsidian Canvas JSON 生成器。你的任务是根据用户提供的内容（包括文本和图片），将其转换为符合 Obsidian Canvas 规范的 JSON 结构。

## 重要：输入内容说明

用户可能提供以下类型的输入：
1. **图片内容**：如果消息中包含图片，请仔细分析图片内容（如流程图、思维导图、界面截图、架构图等），将其中的信息提取并转换为Canvas节点结构
2. **文本内容**：「SOURCE_CONTENT」标签内的文本是需要处理的源内容
3. **用户指令**：「USER_INSTRUCTION」标签内是用户的操作命令（如"总结"、"生成流程图"等）

### ⚠️ 关键规则：用户指令不是内容
「USER_INSTRUCTION」是告诉你**如何处理**内容的元指令，**绝对不能**出现在生成的任何节点的 text 字段中。
例如：如果用户指令是"总结这些内容"，你生成的节点应该只包含总结后的结果，而不是"总结这些内容"这几个字。

### 图片处理指南
如果用户提供了图片：
- 分析图片中的结构、层次、连接关系
- 识别图片中的文字、标签、箭头方向
- 将图片中的信息转换为对应的nodes和edges
- 尽可能保持原图的布局逻辑（从上到下、从左到右等）

## JSON 结构规则

### 1. 结构总览
* 输出必须是一个有效的 JSON 对象
* JSON 对象必须包含两个顶级键：nodes (数组) 和 edges (数组)

### 2. 节点类型
**只使用 type: "text"**（不要使用 group 或 link 类型）

每个节点必须包含：
* id: (字符串) 唯一标识符，使用 UUIDv4 格式
* type: "text"
* x, y: (数字) 坐标
* width, height: (数字) 尺寸，建议 200-400 x 80-200
* text: (字符串) 节点的文本内容（必填，不能为空）
* color: (可选) "1"-"6"

### 3. 层级关系表示（重要）
如果需要表示分类或层级关系（如"类别"包含多个"子项"），请使用以下模式：
- 创建一个"标题节点"作为分类名称
- 创建多个"内容节点"作为子项
- 使用**edges从标题节点连向各个内容节点**来表示从属关系

示例 - 表示"核心要素"包含三个子项：
\`\`\`json
{
  "nodes": [
    {"id":"title-1","type":"text","x":200,"y":0,"width":200,"height":60,"text":"核心要素","color":"5"},
    {"id":"item-1","type":"text","x":0,"y":150,"width":250,"height":80,"text":"子项A的内容"},
    {"id":"item-2","type":"text","x":280,"y":150,"width":250,"height":80,"text":"子项B的内容"},
    {"id":"item-3","type":"text","x":560,"y":150,"width":250,"height":80,"text":"子项C的内容"}
  ],
  "edges": [
    {"id":"e1","fromNode":"title-1","toNode":"item-1","fromSide":"bottom","toSide":"top"},
    {"id":"e2","fromNode":"title-1","toNode":"item-2","fromSide":"bottom","toSide":"top"},
    {"id":"e3","fromNode":"title-1","toNode":"item-3","fromSide":"bottom","toSide":"top"}
  ]
}
\`\`\`

### 4. 连接线 (Edges) 规则
每条边必须包含：
* id: 唯一标识符
* fromNode, toNode: 源/目标节点 ID
* fromSide, toSide: "top" | "right" | "bottom" | "left"
* toEnd: (可选) "arrow"

### 5. 布局建议
* 标题节点在顶部，内容节点在下方
* 从左到右或从上到下布局
* 节点间距保持 50-100 像素，避免重叠

### 6. 质量约束（严格遵守）
* **禁止空节点**：text 字段必须有实际内容
* **连通性要求**：所有节点通过 edges 连接，不允许孤立节点
* **禁止 group 类型**：只使用 text 类型节点

### 7. 输出格式
Output ONLY raw JSON. Do not wrap in markdown code blocks. Ensure all IDs are UUIDv4.`;
    }

    /**
     * Replace Ghost Node with Canvas data by directly modifying the .canvas file
     * This is more reliable than using undocumented Canvas API methods
     */
    private async replaceGhostWithCanvasData(
        canvas: Canvas,
        ghostNode: CanvasNode,
        data: CanvasData
    ): Promise<void> {
        const ghostNodeId = ghostNode.id;

        // Validate ghost node is still tracked (not already replaced by another concurrent operation)
        if (!this.activeGhostNodeIds.has(ghostNodeId)) {
            console.warn(`Canvas AI: Ghost node ${ghostNodeId} already replaced, skipping duplicate replacement (Node Mode)`);
            return;
        }

        // Check if the ghost node still exists in the canvas
        const existingNode = canvas.nodes?.get(ghostNodeId);
        if (!existingNode) {
            console.warn(`Canvas AI: Ghost node ${ghostNodeId} no longer exists in canvas, skipping (Node Mode)`);
            this.activeGhostNodeIds.delete(ghostNodeId);
            return;
        }

        // Remove from tracking BEFORE replacement to prevent race conditions
        this.activeGhostNodeIds.delete(ghostNodeId);

        // Get the canvas file
        const canvasView = this.app.workspace.getActiveViewOfType(ItemView) as any;
        const canvasFile = canvasView?.file as TFile | undefined;

        if (!canvasFile || canvasFile.extension !== 'canvas') {
            throw new Error('Cannot find canvas file');
        }

        // Read current canvas data
        const fileContent = await this.app.vault.read(canvasFile);
        let canvasJson: { nodes: any[], edges: any[] };

        try {
            canvasJson = JSON.parse(fileContent);
        } catch (e) {
            throw new Error('Failed to parse canvas file');
        }

        // Find and remove the ghost node from canvas data
        canvasJson.nodes = canvasJson.nodes.filter((n: any) => n.id !== ghostNodeId);

        // Add new nodes from LLM response
        // Override color if nodeDefaultColor is set in settings
        const overrideColor = this.settings.nodeDefaultColor || undefined;

        for (const node of data.nodes) {
            canvasJson.nodes.push({
                id: node.id,
                type: node.type,
                x: Math.round(node.x),
                y: Math.round(node.y),
                width: Math.round(node.width),
                height: Math.round(node.height),
                text: node.text,
                color: overrideColor || node.color,  // Use override if set, otherwise LLM value
                label: node.label,
                url: node.url
            });
        }

        // Add new edges from LLM response
        for (const edge of data.edges) {
            canvasJson.edges.push({
                id: edge.id,
                fromNode: edge.fromNode,
                toNode: edge.toNode,
                fromSide: edge.fromSide || 'right',
                toSide: edge.toSide || 'left',
                fromEnd: edge.fromEnd,
                toEnd: edge.toEnd,
                color: edge.color,
                label: edge.label
            });
        }

        // Write updated canvas data back to file
        await this.app.vault.modify(canvasFile, JSON.stringify(canvasJson, null, '\t'));

        // The canvas should auto-reload, but we can trigger a refresh
        // by requesting save (which will cause canvas to reload from file)
        setTimeout(() => {
            canvas.requestSave();
        }, 100);
    }

    /**
     * Save base64 image to vault
     * Detects MIME type from data URL and uses correct file extension
     */
    private async saveImageToVault(base64Data: string, prompt: string): Promise<TFile> {
        // Extract MIME type and base64 data
        let mimeType = 'image/png';
        let base64 = base64Data;

        const dataUrlMatch = base64Data.match(/^data:(image\/\w+);base64,(.+)$/);
        if (dataUrlMatch) {
            mimeType = dataUrlMatch[1];
            base64 = dataUrlMatch[2];
        }

        // Determine file extension based on MIME type
        let extension = '.png';
        if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
            extension = '.jpg';
        } else if (mimeType === 'image/webp') {
            extension = '.webp';
        } else if (mimeType === 'image/gif') {
            extension = '.gif';
        }

        // Convert base64 to buffer
        const buffer = this.base64ToArrayBuffer(base64);

        // Generate simple timestamp-based filename (YYYYMMDDHHMMSS format)
        const now = new Date();
        const timestamp = now.getFullYear().toString() +
            String(now.getMonth() + 1).padStart(2, '0') +
            String(now.getDate()).padStart(2, '0') +
            String(now.getHours()).padStart(2, '0') +
            String(now.getMinutes()).padStart(2, '0') +
            String(now.getSeconds()).padStart(2, '0');
        const filename = `ai_image_${timestamp}${extension}`;

        // Check/Create "Canvas Images" folder in root
        const folderName = "Canvas Images";
        const existingFolder = this.app.vault.getAbstractFileByPath(folderName);
        if (!existingFolder) {
            try {
                await this.app.vault.createFolder(folderName);
            } catch (e: any) {
                if (!this.app.vault.getAbstractFileByPath(folderName)) {
                    console.error('Canvas AI: Failed to create folder:', e);
                    throw new Error(`Failed to create Canvas Images folder: ${e.message}`);
                }
            }
        }

        const filePath = `${folderName}/${filename}`;
        console.log(`Canvas AI: Saving image to ${filePath}, mimeType: ${mimeType}`);
        return await this.app.vault.createBinary(filePath, buffer);
    }

    /**
     * Helper: Base64 to ArrayBuffer
     */
    private base64ToArrayBuffer(base64: string): ArrayBuffer {
        const binaryString = window.atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }

    /**
     * Replace Ghost Node with real File Node
     */
    private replaceGhostWithImageNode(canvas: Canvas, ghostNode: CanvasNode, file: TFile): void {
        const ghostNodeId = ghostNode.id;

        // Validate ghost node is still tracked (not already replaced by another concurrent operation)
        if (!this.activeGhostNodeIds.has(ghostNodeId)) {
            console.warn(`Canvas AI: Ghost node ${ghostNodeId} already replaced, skipping duplicate replacement`);
            return;
        }

        // Check if the ghost node still exists in the canvas
        const existingNode = canvas.nodes?.get(ghostNodeId);
        if (!existingNode) {
            console.warn(`Canvas AI: Ghost node ${ghostNodeId} no longer exists in canvas, skipping`);
            this.activeGhostNodeIds.delete(ghostNodeId);
            return;
        }

        // Remove from tracking BEFORE replacement to prevent race conditions
        this.activeGhostNodeIds.delete(ghostNodeId);

        const { x, y, width } = ghostNode;
        // Calculate aspect ratio height if needed, default square for 1:1
        const height = width;

        // Remove ghost
        (canvas as any).removeNode(ghostNode);

        // Create file node
        const fileNode = (canvas as any).createFileNode({
            file: file,
            pos: { x, y, width, height },
            size: { x, y, width, height },
            save: true,
            focus: false
        });

        canvas.requestSave();
        console.log(`Canvas AI: Replaced ghost node ${ghostNodeId} with image node`);
    }

    /**
     * Create a ghost node (loading placeholder)
     */
    private createGhostNode(canvas: Canvas, x: number, y: number): CanvasNode {
        const node = canvas.createTextNode({
            pos: { x, y, width: 400, height: 100 },
            size: { x, y, width: 400, height: 100 },
            text: '🍌 AI Generating...',
            focus: false,
            save: true
        });

        // Track this ghost node to prevent race conditions
        this.activeGhostNodeIds.add(node.id);

        // Add ghost node styling
        if (node.nodeEl) {
            node.nodeEl.addClass('canvas-ai-ghost-node');
        }

        canvas.requestSave();
        return node;
    }

    /**
     * Update ghost node with response
     * Dynamically resize node height based on content length
     */
    private updateGhostNode(node: CanvasNode, content: string, isError: boolean, keepTracking: boolean = false): void {
        // When updating ghost node to final state, remove from tracking
        // (it's no longer a "ghost" that needs to be replaced)
        if (!keepTracking) {
            this.activeGhostNodeIds.delete(node.id);
        }

        // Remove ghost styling
        if (node.nodeEl) {
            node.nodeEl.removeClass('canvas-ai-ghost-node');
            if (isError) {
                node.nodeEl.addClass('canvas-ai-error-node');
            }
        }

        // Update node text content
        // Access the internal data and update
        (node as any).setText?.(content);

        // Alternative: directly set text property and re-render
        if (!((node as any).setText)) {
            (node as any).text = content;
            node.render?.();
        }

        // ========== Dynamic height adjustment ==========
        // Estimate height based on content:
        // - Count number of lines
        // - Consider average characters per line (approximately 50 chars at 400px width)
        const lines = content.split('\n');
        const lineCount = lines.length;

        // Estimate wrapped lines for long lines
        let totalEstimatedLines = 0;
        const charsPerLine = 50; // Approximate chars per line at 400px width
        for (const line of lines) {
            const lineLen = line.length;
            if (lineLen === 0) {
                totalEstimatedLines += 1; // Empty line
            } else {
                totalEstimatedLines += Math.ceil(lineLen / charsPerLine);
            }
        }

        // Calculate height: ~24px per line, minimum 100px, maximum 600px
        const lineHeight = 24;
        const padding = 40; // Top + bottom padding
        const estimatedHeight = Math.min(
            Math.max(100, totalEstimatedLines * lineHeight + padding),
            600
        );

        // Update node dimensions
        if ((node as any).resize) {
            (node as any).resize({ width: 400, height: estimatedHeight });
        } else {
            // Fallback: directly set dimensions
            node.width = 400;
            node.height = estimatedHeight;
        }

        node.canvas?.requestSave();
        console.log(`Canvas AI: Ghost Node updated, estimated ${totalEstimatedLines} lines, height: ${estimatedHeight}px`);
    }

    /**
     * Get selection bounding box (canvas coordinates)
     */
    private getSelectionBBox(selection: Set<CanvasNode>): CanvasCoords | null {
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        let hasNode = false;

        selection.forEach(node => {
            minX = Math.min(minX, node.x);
            minY = Math.min(minY, node.y);
            maxX = Math.max(maxX, node.x + node.width);
            maxY = Math.max(maxY, node.y + node.height);
            hasNode = true;
        });

        if (!hasNode) return null;
        return { minX, minY, maxX, maxY };
    }

    // Track last click target type for robust closing
    private lastClickWasBackground: boolean = false;
    private lastInteractionWasDeleteOrEsc: boolean = false;

    /**
     * 注册 Canvas 选中状态监听
     */
    private registerCanvasSelectionListener(): void {
        // 监听布局变化（包括选中状态变化）
        this.registerEvent(
            this.app.workspace.on('layout-change', () => {
                this.checkCanvasSelection();
            })
        );

        // 监听全局鼠标按下事件，用于判断点击意图
        this.registerDomEvent(document, 'mousedown', (evt: MouseEvent) => {
            // 鼠标操作时，重置键盘状态
            this.lastInteractionWasDeleteOrEsc = false;

            const target = evt.target as HTMLElement;
            // 检查是否点击了 Canvas 及其 UI 元素
            const isCanvasClick = target.closest('.canvas-wrapper');
            if (isCanvasClick) {
                // 如果点击了 节点、连线、或者我们的 AI 面板，则不算"背景点击"
                const isNode = target.closest('.canvas-node');
                const isEdge = target.closest('.canvas-edge');
                const isPalette = target.closest('.canvas-ai-palette');
                const isMenu = target.closest('.menu'); // 上下文菜单

                if (!isNode && !isEdge && !isPalette && !isMenu) {
                    this.lastClickWasBackground = true;
                } else {
                    this.lastClickWasBackground = false;
                }
            } else {
                // Canvas 区域外点击，视为背景点击 (用于关闭)
                this.lastClickWasBackground = true;
            }
        });

        // 监听 Escape 键 - 使用捕获阶段确保先于 Obsidian 处理
        const escapeHandler = (evt: KeyboardEvent) => {
            if (evt.key === 'Escape') {
                // Escape 直接关闭面板（如果面板可见）
                if (this.floatingPalette?.visible) {
                    this.floatingPalette.hide();
                    evt.preventDefault();
                    evt.stopPropagation();
                    evt.stopImmediatePropagation();
                }
            }
        };
        document.addEventListener('keydown', escapeHandler, true); // capture: true
        this.register(() => document.removeEventListener('keydown', escapeHandler, true));

        // 监听键盘事件，用于捕获 Delete/Backspace
        this.registerDomEvent(document, 'keydown', (evt: KeyboardEvent) => {
            if (evt.key === 'Delete' || evt.key === 'Backspace') {
                this.lastInteractionWasDeleteOrEsc = true;
                // 重置鼠标状态
                this.lastClickWasBackground = false;
            } else if (evt.key !== 'Escape') {
                // 不重置 Escape 相关状态，因为它已经在上面的 handler 处理了
                this.lastInteractionWasDeleteOrEsc = false;
            }
        });

        // 监听活动叶子变化
        this.registerEvent(
            this.app.workspace.on('active-leaf-change', (leaf) => {
                // 只有当真正的 View 发生变化时才隐藏
                // 如果在同一个 Canvas 内切换焦点，不应该隐藏
                const currentView = this.app.workspace.getActiveViewOfType(ItemView);
                if (currentView?.getViewType() === 'canvas' && leaf?.view === currentView) {
                    return;
                }
                this.hideAllFloatingComponents();
            })
        );

        // 监听文件打开（切换文件时隐藏）
        // 只有当真正离开 Canvas 视图时才隐藏，点击 Canvas 内的文件节点不应该隐藏面板
        this.registerEvent(
            this.app.workspace.on('file-open', () => {
                const currentView = this.app.workspace.getActiveViewOfType(ItemView);
                if (currentView?.getViewType() !== 'canvas') {
                    this.hideAllFloatingComponents();
                }
            })
        );

        // 使用 requestAnimationFrame 轮询检查选中状态（更及时）
        this.registerInterval(
            window.setInterval(() => {
                this.checkCanvasSelection();
            }, 200)
        );
    }

    /**
     * 检查 Canvas 选中状态
     */
    private checkCanvasSelection(): void {
        const canvasView = this.app.workspace.getActiveViewOfType(ItemView);

        // 检查是否在 Canvas 视图
        if (!canvasView || canvasView.getViewType() !== 'canvas') {
            this.hideAllFloatingComponents();
            return;
        }

        // 获取 Canvas 实例 (使用 any 绕过类型检查)
        const canvas = (canvasView as any).canvas as Canvas | undefined;
        if (!canvas) {
            this.hideAllFloatingComponents();
            return;
        }

        const selection = canvas.selection;
        const selectionSize = selection?.size ?? 0;
        const currentIds = new Set(Array.from(selection || []).map((n: CanvasNode) => n.id));

        // 规则 3: 取消所有选中 -> 面板消失 
        // 改进：只有在明确点击背景或按下 Delete/Esc 时才关闭面板
        // 对于其他原因导致的 selectionSize === 0（如切换节点的过渡态），完全忽略
        if (selectionSize === 0) {
            const shouldCloseExplicitly = this.lastClickWasBackground || this.lastInteractionWasDeleteOrEsc;

            if (this.floatingPalette?.visible && !this.hideTimer && shouldCloseExplicitly) {
                // 明确的关闭意图：快速关闭
                this.hideTimer = window.setTimeout(() => {
                    // 二次确认：计时器结束时，如果真的还是 0 选中，才关闭
                    const currentSelection = (canvas as any).selection;
                    if (!currentSelection || currentSelection.size === 0) {
                        this.floatingPalette?.hide();
                        this.lastSelectedIds.clear();
                        this.lastSelectionSize = 0;
                    }
                    this.hideTimer = null;
                }, 50);
            }
            // 如果没有明确的关闭意图，完全不做任何事情，等待新的选中
            return;
        }

        // 有选中：立即取消正在进行的隐藏倒计时
        if (this.hideTimer) {
            window.clearTimeout(this.hideTimer);
            this.hideTimer = null;
        }

        // 重置状态
        this.lastClickWasBackground = false;
        this.lastInteractionWasDeleteOrEsc = false;

        // 向原生工具条注入按钮
        this.injectAiButtonToPopupMenu(canvas);

        // 如果面板当前是显示状态，检查是否需要自动关闭或更新位置
        if (this.floatingPalette?.visible) {
            // 规则: 选中变化 -> 更新位置
            const screenBBox = this.getSelectionScreenBBox(selection);
            if (screenBBox) {
                const paletteX = screenBBox.right + 20;
                const paletteY = screenBBox.top;
                this.floatingPalette.updatePosition(paletteX, paletteY, canvas.wrapperEl);
            }
        }

        // 更新上下文预览
        if (this.floatingPalette?.visible) {
            const { imageCount, textCount, groupCount } = this.countNodeTypes(selection);
            this.floatingPalette.updateContextPreview(selectionSize, imageCount, textCount, groupCount);
        }

        // 更新状态记录
        this.lastSelectionSize = selectionSize;
        this.lastSelectedIds = currentIds;
    }

    /**
     * 向 Canvas 原生 popup menu 注入 AI 按钮
     */
    private injectAiButtonToPopupMenu(canvas: Canvas): void {
        const menuEl = canvas.menu?.menuEl;
        if (!menuEl) return;

        // 如果已存在，不重复添加
        if (menuEl.querySelector(`#${AI_SPARKLES_BUTTON_ID}`)) return;

        // 创建 AI 按钮
        const aiButton = document.createElement('button');
        aiButton.id = AI_SPARKLES_BUTTON_ID;
        aiButton.classList.add('clickable-icon');
        setIcon(aiButton, 'banana');
        setTooltip(aiButton, 'CanvasBanana', { placement: 'top' });

        aiButton.addEventListener('click', (e) => {
            e.stopPropagation();
            this.onSparklesButtonClick();
        });

        // 添加到工具条末尾
        menuEl.appendChild(aiButton);
    }

    /**
     * 获取选中节点的屏幕坐标包围盒
     * 使用节点 DOM 元素的 getBoundingClientRect 获取真实屏幕位置
     */
    private getSelectionScreenBBox(selection: Set<CanvasNode>): DOMRect | null {
        let left = Infinity, top = Infinity;
        let right = -Infinity, bottom = -Infinity;
        let hasValidNode = false;

        selection.forEach(node => {
            // 获取节点 DOM 元素的屏幕坐标
            const nodeEl = node.nodeEl;
            if (nodeEl) {
                const rect = nodeEl.getBoundingClientRect();
                left = Math.min(left, rect.left);
                top = Math.min(top, rect.top);
                right = Math.max(right, rect.right);
                bottom = Math.max(bottom, rect.bottom);
                hasValidNode = true;
            }
        });

        if (!hasValidNode) return null;

        return new DOMRect(left, top, right - left, bottom - top);
    }

    /**
     * 统计节点类型数量
     * 会展开 group 节点，统计其内部的子节点
     */
    private countNodeTypes(selection: Set<CanvasNode>): { imageCount: number; textCount: number; groupCount: number } {
        let imageCount = 0;
        let textCount = 0;
        let groupCount = 0;

        // Get canvas for expanding groups
        const canvasView = this.app.workspace.getActiveViewOfType(ItemView);
        const canvas = canvasView?.getViewType() === 'canvas'
            ? (canvasView as any).canvas as Canvas | undefined
            : undefined;

        // Expand group nodes to include their children
        const expandedSelection = canvas
            ? CanvasConverter.expandGroupNodes(canvas, selection)
            : selection;

        expandedSelection.forEach(node => {
            if ((node as any).label !== undefined) {
                // Group 节点（有 label 属性）
                groupCount++;
            } else if (node.file) {
                // 文件节点，检查是否为图片
                const ext = node.file.extension?.toLowerCase();
                if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) {
                    imageCount++;
                } else {
                    textCount++;
                }
            } else if (node.text !== undefined) {
                textCount++;
            } else if (node.url) {
                textCount++; // 链接节点算作文本
            }
        });

        return { imageCount, textCount, groupCount };
    }

    /**
     * 调试：打印选中节点的详细信息
     * 用于步骤 2.1 和 2.2 的测试验证
     */
    private async debugSelectedNodes(mode: PaletteMode): Promise<void> {
        const canvasView = this.app.workspace.getActiveViewOfType(ItemView);

        if (!canvasView || canvasView.getViewType() !== 'canvas') {
            console.log('Canvas AI Debug: Not in Canvas view');
            return;
        }

        const canvas = (canvasView as any).canvas as Canvas | undefined;
        if (!canvas) {
            console.log('Canvas AI Debug: Canvas not found');
            return;
        }

        const selection = canvas.selection;
        if (!selection || selection.size === 0) {
            console.log('Canvas AI Debug: No nodes selected');
            return;
        }

        console.group('🔍 Canvas AI Debug: Selected Nodes');
        console.log('Current Mode:', mode);

        // 步骤 2.1：打印每个节点的原始信息
        console.group('📋 Raw Node Data');
        selection.forEach((node: CanvasNode) => {
            console.log('---');
            console.log('ID:', node.id);

            if (node.text !== undefined) {
                console.log('Type: Text');
                console.log('Content:', node.text);
            } else if (node.file) {
                console.log('Type: File');
                console.log('File Path:', node.file.path);
                console.log('File Extension:', node.file.extension);
                console.log('File Name:', node.file.name);
            } else if (node.url) {
                console.log('Type: Link');
                console.log('URL:', node.url);
            } else if (node.label !== undefined) {
                console.log('Type: Group');
                console.log('Label:', node.label);
            } else {
                console.log('Type: Unknown');
                console.log('Node Object:', node);
            }
        });
        console.groupEnd();

        // 步骤 2.2：使用 CanvasConverter 进行格式转换（异步）
        console.group('📝 Converted Output');
        const result = await CanvasConverter.convert(this.app, canvas, selection);

        console.log('Converted Nodes:', result.nodes);
        console.log('Converted Edges:', result.edges);
        console.log('\n--- Markdown Output ---\n');
        console.log(result.markdown);
        console.log('\n--- Mermaid Output ---\n');
        console.log(result.mermaid);
        console.groupEnd();

        // ========== 新增：IntentResolver 解析输出 ==========
        console.group(`🎨 IntentResolver Output (${mode} Mode Simulation)`);
        try {
            // Get prompt from palette (might be empty)
            const prompt = this.floatingPalette?.getPrompt() || '';

            const intent = await IntentResolver.resolve(
                this.app,
                canvas,
                selection,
                prompt,
                mode,
                this.settings
            );

            console.log('✅ canGenerate:', intent.canGenerate);

            if (intent.images.length > 0) {
                console.group('📷 Images with Roles');
                intent.images.forEach((img, idx) => {
                    console.log(`[${idx + 1}] Role: "${img.role}", MimeType: ${img.mimeType}, Base64 Length: ${img.base64.length}`);
                });
                console.groupEnd();
            } else {
                console.log('(No images in selection)');
            }

            console.group('📝 Instruction');
            console.log('Final Instruction:', intent.instruction);
            console.groupEnd();

            console.group('📄 Context Text');
            if (intent.contextText) {
                console.log(intent.contextText);
            } else {
                console.log('(No context text)');
            }
            console.groupEnd();

            if (intent.warnings.length > 0) {
                console.group('⚠️ Warnings');
                intent.warnings.forEach(w => console.warn(w));
                console.groupEnd();
            }

            // 模拟 Payload 结构
            console.group('📦 Simulated API Payload Structure');

            let payloadPreview: any;

            if (mode === 'chat') {
                const systemPrompt = this.settings.chatSystemPrompt || 'You are a helpful AI assistant...';
                payloadPreview = {
                    model: this.settings.apiProvider === 'openrouter' ? this.settings.openRouterTextModel : (this.settings.apiProvider === 'yunwu' ? this.settings.yunwuTextModel : this.settings.geminiTextModel),
                    mode: 'chat',
                    systemPrompt: systemPrompt,
                    modalities: ['text'],
                    content_structure: [
                        { type: 'text', text: intent.instruction },
                        ...(intent.contextText ? [{ type: 'text', text: `[Context] ...` }] : []),
                        ...intent.images.map(img => ({ type: 'image_url', base64_length: img.base64.length }))
                    ]
                };
            } else if (mode === 'node') {
                const systemPrompt = this.settings.nodeSystemPrompt || 'Default Node Prompt...';
                payloadPreview = {
                    model: this.settings.apiProvider === 'openrouter' ? this.settings.openRouterTextModel : (this.settings.apiProvider === 'yunwu' ? this.settings.yunwuTextModel : this.settings.geminiTextModel),
                    mode: 'node',
                    systemPrompt: systemPrompt,
                    modalities: ['text'],
                    content_structure: [
                        { type: 'text', text: '[SOURCE_CONTENT]...' },
                        { type: 'text', text: '[TASK] ' + intent.instruction },
                        ...intent.images.map(img => ({ type: 'image_url', base64_length: img.base64.length }))
                    ]
                };
            } else {
                // Image Mode
                const systemPrompt = this.settings.imageSystemPrompt || 'Role: A Professional Image Creator...';
                payloadPreview = {
                    model: this.settings.apiProvider === 'openrouter' ? this.settings.openRouterImageModel : (this.settings.apiProvider === 'yunwu' ? this.settings.yunwuImageModel : this.settings.geminiImageModel),
                    mode: 'image',
                    systemPrompt: systemPrompt, // Show what system prompt will be used
                    modalities: ['image', 'text'],
                    content_structure: [
                        // REMOVED duplicate system prompt injection here
                        ...intent.images.map(img => [
                            { type: 'text', text: `[Ref: ${img.role}]` },
                            { type: 'image_url', base64_length: img.base64.length }
                        ]).flat(),
                        intent.contextText ? { type: 'text', text: '[Context]...' } : null,
                        { type: 'text', text: `INSTRUCTION: ${intent.instruction.substring(0, 100)}${intent.instruction.length > 100 ? '...' : ''}` }
                    ].filter(Boolean)
                };
            }

            console.log(JSON.stringify(payloadPreview, null, 2));
            console.groupEnd();

        } catch (e) {
            console.error('IntentResolver failed:', e);
        }
        console.groupEnd();

        console.groupEnd();
    }

    /**
     * Sparkles 按钮点击处理
     */
    private onSparklesButtonClick(): void {
        if (!this.floatingPalette) return;

        if (this.floatingPalette.visible) {
            this.floatingPalette.hide();
        } else {
            // 获取当前 Canvas
            const canvasView = this.app.workspace.getActiveViewOfType(ItemView);
            if (!canvasView || canvasView.getViewType() !== 'canvas') return;

            const canvas = (canvasView as any).canvas as Canvas | undefined;
            if (!canvas || canvas.selection.size === 0) return;

            // 获取选中节点位置
            const screenBBox = this.getSelectionScreenBBox(canvas.selection);
            if (!screenBBox) return;

            // 面板位置：选中框右侧 (与 checkCanvasSelection 保持一致)
            const paletteX = screenBBox.right + 20;
            const paletteY = screenBBox.top;

            // 记录当前选中 ID，防止 checkCanvasSelection 误判为切换上下文而自动关闭
            this.lastSelectedIds = new Set(Array.from(canvas.selection).map(n => n.id));
            this.lastSelectionSize = canvas.selection.size;

            // 显示弹窗
            this.floatingPalette.show(paletteX, paletteY, canvas.wrapperEl, () => {
                // 关闭时的回调
            });

        }
    }

    /**
     * 隐藏所有悬浮组件
     */
    private hideAllFloatingComponents(): void {
        this.floatingPalette?.hide();
        this.lastSelectionSize = 0;
    }

    // ========== Canvas Utilities ==========

    /**
     * Register Canvas utility commands and events
     * Called in onload after other listeners
     */
    private registerCanvasUtilities(): void {
        // Double-click to open image in new window
        this.registerDomEvent(document, 'dblclick', async (evt: MouseEvent) => {
            const target = evt.target as HTMLElement;
            const nodeEl = target.closest('.canvas-node');
            if (!nodeEl) return;

            const canvas = this.getActiveCanvas();
            if (!canvas) return;

            const imageNode = this.getSelectedImageNode(canvas);
            if (imageNode?.file) {
                evt.preventDefault();
                evt.stopPropagation();
                await this.openImageInNewWindow(imageNode.file);
            }
        });

        // Register Obsidian commands for hotkey integration
        this.addCommand({
            id: 'copy-image-to-clipboard',
            name: t('Copy Image to Clipboard'),
            hotkeys: [{ modifiers: ['Alt'], key: 'c' }],
            checkCallback: (checking: boolean) => {
                const canvas = this.getActiveCanvas();
                const imageNode = this.getSelectedImageNode(canvas);
                if (imageNode?.file) {
                    if (!checking) {
                        this.copyImageToClipboard(imageNode.file);
                    }
                    return true;
                }
                return false;
            }
        });

        this.addCommand({
            id: 'create-group-from-selection',
            name: t('Create Group'),
            hotkeys: [{ modifiers: ['Alt'], key: 'g' }],
            checkCallback: (checking: boolean) => {
                const canvas = this.getActiveCanvas();
                if (canvas && canvas.selection.size > 0) {
                    if (!checking) {
                        this.createGroupFromSelection(canvas);
                    }
                    return true;
                }
                return false;
            }
        });

        this.addCommand({
            id: 'open-ai-palette',
            name: t('Open AI Palette'),
            hotkeys: [{ modifiers: ['Alt'], key: 'b' }],
            checkCallback: (checking: boolean) => {
                const canvas = this.getActiveCanvas();
                if (canvas && canvas.selection.size > 0) {
                    if (!checking) {
                        this.onSparklesButtonClick();
                    }
                    return true;
                }
                return false;
            }
        });

        this.addCommand({
            id: 'create-new-node',
            name: t('Create New Node'),
            hotkeys: [{ modifiers: ['Alt'], key: 'n' }],
            checkCallback: (checking: boolean) => {
                const canvas = this.getActiveCanvas();
                if (canvas) {
                    if (!checking) {
                        this.createNewNodeAtCenter(canvas);
                    }
                    return true;
                }
                return false;
            }
        });
    }

    /**
     * Get the active Canvas instance
     */
    private getActiveCanvas(): Canvas | null {
        const canvasView = this.app.workspace.getActiveViewOfType(ItemView);
        if (!canvasView || canvasView.getViewType() !== 'canvas') return null;
        return (canvasView as any).canvas as Canvas | null;
    }

    /**
     * Check if current view is Canvas
     */
    private isCanvasViewActive(): boolean {
        const view = this.app.workspace.getActiveViewOfType(ItemView);
        return view?.getViewType() === 'canvas';
    }

    /**
     * Get the selected image node (only if single image selected)
     */
    private getSelectedImageNode(canvas: Canvas | null): CanvasNode | null {
        if (!canvas || canvas.selection.size !== 1) return null;
        const node = Array.from(canvas.selection)[0];
        if (!node.file) return null;
        const ext = node.file.extension?.toLowerCase();
        if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) {
            return node;
        }
        return null;
    }

    /**
     * Match keyboard event against hotkey string (e.g., "Alt+C")
     */
    private matchesHotkey(evt: KeyboardEvent, hotkey: string): boolean {
        if (!hotkey) return false;
        const parts = hotkey.toLowerCase().split('+');
        const key = parts[parts.length - 1];
        const needCtrl = parts.includes('ctrl');
        const needShift = parts.includes('shift');
        const needAlt = parts.includes('alt');

        return evt.key.toLowerCase() === key &&
            evt.ctrlKey === needCtrl &&
            evt.shiftKey === needShift &&
            evt.altKey === needAlt;
    }

    /**
     * Open image file in a new popout window
     */
    private async openImageInNewWindow(file: TFile): Promise<void> {
        try {
            const leaf = this.app.workspace.openPopoutLeaf();
            await leaf.openFile(file);
        } catch (e) {
            console.error('Canvas AI: Failed to open image in new window:', e);
        }
    }

    /**
     * Copy image to clipboard (converts to PNG if needed)
     */
    private async copyImageToClipboard(file: TFile): Promise<void> {
        try {
            const arrayBuffer = await this.app.vault.readBinary(file);
            const mimeType = this.getMimeType(file.extension);
            const blob = new Blob([arrayBuffer], { type: mimeType });

            // Clipboard API only supports PNG, convert if needed
            let pngBlob: Blob;
            if (file.extension.toLowerCase() === 'png') {
                pngBlob = blob;
            } else {
                pngBlob = await this.convertToPng(blob);
            }

            await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': pngBlob })
            ]);

            new Notice(t('Image copied'));
        } catch (error) {
            console.error('Canvas AI: Failed to copy image:', error);
            new Notice(t('No image selected'));
        }
    }

    /**
     * Get MIME type from file extension
     */
    private getMimeType(ext: string): string {
        const map: Record<string, string> = {
            'png': 'image/png',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'gif': 'image/gif',
            'webp': 'image/webp',
            'svg': 'image/svg+xml',
            'bmp': 'image/bmp'
        };
        return map[ext.toLowerCase()] || 'image/png';
    }

    /**
     * Convert image blob to PNG using Canvas API
     */
    private async convertToPng(blob: Blob): Promise<Blob> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    reject(new Error('Failed to get canvas context'));
                    return;
                }
                ctx.drawImage(img, 0, 0);
                canvas.toBlob((pngBlob) => {
                    URL.revokeObjectURL(img.src);
                    if (pngBlob) {
                        resolve(pngBlob);
                    } else {
                        reject(new Error('Failed to convert to PNG'));
                    }
                }, 'image/png');
            };
            img.onerror = () => {
                URL.revokeObjectURL(img.src);
                reject(new Error('Failed to load image'));
            };
            img.src = URL.createObjectURL(blob);
        });
    }

    /**
     * Create a group from selected nodes
     */
    private createGroupFromSelection(canvas: Canvas): void {
        try {
            const selection = canvas.selection;
            if (selection.size === 0) return;

            // Calculate bounding box of selected nodes
            let minX = Infinity, minY = Infinity;
            let maxX = -Infinity, maxY = -Infinity;

            selection.forEach((node: CanvasNode) => {
                minX = Math.min(minX, node.x);
                minY = Math.min(minY, node.y);
                maxX = Math.max(maxX, node.x + node.width);
                maxY = Math.max(maxY, node.y + node.height);
            });

            // Add padding around the group
            const padding = 20;
            const groupX = minX - padding;
            const groupY = minY - padding;
            const groupWidth = (maxX - minX) + padding * 2;
            const groupHeight = (maxY - minY) + padding * 2;

            // Create group node using Canvas internal API
            if (typeof (canvas as any).createGroupNode === 'function') {
                const groupNode = (canvas as any).createGroupNode({
                    pos: { x: groupX, y: groupY },
                    size: { width: groupWidth, height: groupHeight },
                    label: '',
                    save: true
                });

                // Move group to back (lower z-index)
                if (groupNode && typeof groupNode.moveToBack === 'function') {
                    groupNode.moveToBack();
                }

                canvas.requestSave();
                new Notice(t('Group created'));
            } else {
                // Fallback: try using menu method
                if (canvas.menu && typeof (canvas.menu as any).groupNodes === 'function') {
                    (canvas.menu as any).groupNodes();
                    new Notice(t('Group created'));
                } else {
                    console.warn('Canvas AI: No group creation API available');
                    new Notice('Group creation not available');
                }
            }
        } catch (e) {
            console.error('Canvas AI: Failed to create group:', e);
        }
    }

    /**
     * Create a new text node at viewport center
     */
    private createNewNodeAtCenter(canvas: Canvas): void {
        try {
            // Get viewport center in canvas coordinates
            const viewportCenter = this.getViewportCenter(canvas);

            const node = canvas.createTextNode({
                pos: { x: viewportCenter.x - 100, y: viewportCenter.y - 50, width: 200, height: 100 },
                size: { x: viewportCenter.x - 100, y: viewportCenter.y - 50, width: 200, height: 100 },
                text: '',
                focus: true,
                save: true
            });

            // Select and start editing the new node
            canvas.deselectAll();
            canvas.select(node);
            node.startEditing?.();

            new Notice(t('Node created'));
        } catch (e) {
            console.error('Canvas AI: Failed to create new node:', e);
        }
    }

    /**
     * Get viewport center in canvas coordinates
     */
    private getViewportCenter(canvas: Canvas): { x: number; y: number } {
        // Canvas stores viewport position in canvas.x, canvas.y
        // and wrapper dimensions give viewport size
        const wrapperEl = canvas.wrapperEl;
        if (wrapperEl) {
            const rect = wrapperEl.getBoundingClientRect();
            // canvas.x and canvas.y represent the center of the viewport in canvas coords
            return { x: canvas.x, y: canvas.y };
        }
        return { x: 0, y: 0 };
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
        // Update ApiManager settings reference
        this.apiManager?.updateSettings(this.settings);
    }

    /**
     * Get current text model based on selected provider
     */
    private getCurrentTextModel(): string {
        switch (this.settings.apiProvider) {
            case 'openrouter':
                return this.settings.openRouterTextModel;
            case 'yunwu':
                return this.settings.yunwuTextModel;
            case 'gemini':
                return this.settings.geminiTextModel;
            case 'gptgod':
                return this.settings.gptGodTextModel;
            default:
                return '';
        }
    }

    /**
     * Set current text model based on selected provider
     */
    private setCurrentTextModel(modelId: string): void {
        switch (this.settings.apiProvider) {
            case 'openrouter':
                this.settings.openRouterTextModel = modelId;
                break;
            case 'yunwu':
                this.settings.yunwuTextModel = modelId;
                break;
            case 'gemini':
                this.settings.geminiTextModel = modelId;
                break;
            case 'gptgod':
                this.settings.gptGodTextModel = modelId;
                break;
        }
    }

    /**
     * Get current image model based on selected provider
     */
    private getCurrentImageModel(): string {
        switch (this.settings.apiProvider) {
            case 'openrouter':
                return this.settings.openRouterImageModel;
            case 'yunwu':
                return this.settings.yunwuImageModel;
            case 'gemini':
                return this.settings.geminiImageModel;
            case 'gptgod':
                return this.settings.gptGodImageModel;
            default:
                return '';
        }
    }

    /**
     * Set current image model based on selected provider
     */
    private setCurrentImageModel(modelId: string): void {
        switch (this.settings.apiProvider) {
            case 'openrouter':
                this.settings.openRouterImageModel = modelId;
                break;
            case 'yunwu':
                this.settings.yunwuImageModel = modelId;
                break;
            case 'gemini':
                this.settings.geminiImageModel = modelId;
                break;
            case 'gptgod':
                this.settings.gptGodImageModel = modelId;
                break;
        }
    }
}

// ========== Settings Tab ==========

// Model info structure from OpenRouter API
interface OpenRouterModel {
    id: string;
    name: string;
    outputModalities: string[];
}

class CanvasAISettingTab extends PluginSettingTab {
    plugin: CanvasAIPlugin;
    private modelCache: OpenRouterModel[] = [];
    private modelsFetched: boolean = false;
    private isFetching: boolean = false;

    constructor(app: App, plugin: CanvasAIPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    /**
     * Fetch models from API (OpenRouter or Yunwu based on provider)
     * For Gemini, use hardcoded model list
     */
    private async fetchModels(): Promise<void> {
        if (this.isFetching) return;

        const provider = this.plugin.settings.apiProvider;
        const isYunwu = provider === 'yunwu';
        const isGemini = provider === 'gemini';
        const isGptGod = provider === 'gptgod';

        // Gemini uses hardcoded model list (no API endpoint)
        if (isGemini) {
            this.modelCache = this.getGeminiHardcodedModels();
            this.modelsFetched = true;
            console.log(`Canvas AI Settings: Loaded ${this.modelCache.length} hardcoded Gemini models`);
            this.display();
            return;
        }

        const apiKey = isYunwu
            ? this.plugin.settings.yunwuApiKey
            : isGptGod
                ? this.plugin.settings.gptGodApiKey
                : this.plugin.settings.openRouterApiKey;

        if (!apiKey) {
            console.log('Canvas AI Settings: No API key, skipping model fetch');
            return;
        }

        this.isFetching = true;
        try {
            let endpoint: string;
            let headers: Record<string, string>;

            if (isYunwu) {
                // Yunwu uses same OpenAI-compatible models endpoint
                endpoint = `${this.plugin.settings.yunwuBaseUrl || 'https://yunwu.ai'}/v1/models`;
                headers = { 'Authorization': `Bearer ${apiKey}` };
            } else if (isGptGod) {
                endpoint = `${this.plugin.settings.gptGodBaseUrl || 'https://api.gptgod.online'}/v1/models`;
                headers = { 'Authorization': `Bearer ${apiKey}` };
            } else {
                endpoint = 'https://openrouter.ai/api/v1/models';
                headers = { 'Authorization': `Bearer ${apiKey}` };
            }

            const response = await fetch(endpoint, {
                method: 'GET',
                headers: headers
            });

            if (!response.ok) {
                throw new Error(`API returned ${response.status}`);
            }

            const data = await response.json();

            // Parse and cache model info
            this.modelCache = (data.data || []).map((m: any) => ({
                id: m.id || '',
                name: m.name || m.id || '',
                outputModalities: m.architecture?.output_modalities || ['text']
            }));

            this.modelsFetched = true;
            console.log(`Canvas AI Settings: Fetched ${this.modelCache.length} models from ${isYunwu ? 'Yunwu' : 'OpenRouter'}`);
        } catch (error: any) {
            console.error('Canvas AI Settings: Failed to fetch models:', error.message);
            // Keep existing cache or empty
            new Notice(`Failed to fetch model list: ${error.message}`);
        } finally {
            this.isFetching = false;
            // Update UI after fetch completes (success or error)
            this.display();
        }
    }

    /**
     * Get hardcoded Gemini models list
     * Gemini doesn't have a public models API, so we maintain a curated list
     */
    private getGeminiHardcodedModels(): OpenRouterModel[] {
        return [
            // Gemini 2.5 series
            { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', outputModalities: ['text'] },
            { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', outputModalities: ['text'] },
            { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', outputModalities: ['text'] },
            { id: 'gemini-2.5-flash-lite-preview-09-2025', name: 'Gemini 2.5 Flash Lite Preview 09-2025', outputModalities: ['text'] },
            { id: 'gemini-2.5-flash-lite-preview-06-17-nothinking', name: 'Gemini 2.5 Flash Lite Preview 06-17 (No Thinking)', outputModalities: ['text'] },
            { id: 'gemini-2.5-pro-preview-06-05', name: 'Gemini 2.5 Pro Preview 06-05', outputModalities: ['text'] },
            { id: 'gemini-2.5-pro-preview-05-06', name: 'Gemini 2.5 Pro Preview 05-06', outputModalities: ['text'] },
            // Gemini 3 series (Image generation)
            { id: 'gemini-3-pro-image-preview', name: 'Gemini 3 Pro Image Preview', outputModalities: ['image'] },
            // GPTGod default
            { id: 'gpt-4-gizmo-g-2fkFE8rbu', name: 'GPT-4 Gizmo', outputModalities: ['text'] },
            // Legacy naming (for backward compatibility)
            { id: 'gemini-pro-latest-thinking-*', name: 'Gemini Pro Latest (Thinking)', outputModalities: ['text'] },
            { id: 'gemini-flash-latest-nothinking', name: 'Gemini Flash Latest (No Thinking)', outputModalities: ['text'] },
        ];
    }

    // Model keyword filters
    private static TEXT_MODEL_KEYWORDS = ['gpt', 'gemini'];
    private static IMAGE_MODEL_KEYWORDS = ['gemini', 'banana'];
    // Exclude keywords for text models (audio, tts, image, vision, etc.)
    private static TEXT_MODEL_EXCLUDE_KEYWORDS = ['audio', 'tts', 'image', 'vision', 'whisper', 'dall-e', 'midjourney'];

    /**
     * Check if model version meets minimum requirements
     * GPT: >= 4.0, Gemini: >= 2.5
     */
    private meetsMinimumVersion(modelId: string): boolean {
        const idLower = modelId.toLowerCase();

        // GPT version check: must be >= 4.0
        if (idLower.includes('gpt')) {
            // Extract version number (e.g., gpt-4.5, gpt-4, gpt-5)
            const gptMatch = idLower.match(/gpt-(\d+)(?:\.(\d+))?/);
            if (gptMatch) {
                const major = parseInt(gptMatch[1]);
                return major >= 4;
            }
            // If no version found, exclude (likely gpt-3.5 or older)
            return false;
        }

        // Gemini version check: must be >= 2.5
        if (idLower.includes('gemini')) {
            // Extract version number (e.g., gemini-2.5, gemini-3)
            const geminiMatch = idLower.match(/gemini-(\d+)(?:\.(\d+))?/);
            if (geminiMatch) {
                const major = parseInt(geminiMatch[1]);
                const minor = geminiMatch[2] ? parseInt(geminiMatch[2]) : 0;
                return major > 2 || (major === 2 && minor >= 5);
            }
            // Legacy naming without version (e.g., gemini-pro-latest) - include them
            return true;
        }

        // For other models, include by default
        return true;
    }

    /**
     * Sort models by provider and version
     * Order: Gemini models first, then GPT models, then others
     * Within each group, sort by version (newest first)
     */
    private sortModels(models: OpenRouterModel[]): OpenRouterModel[] {
        return models.sort((a, b) => {
            const aLower = a.id.toLowerCase();
            const bLower = b.id.toLowerCase();

            const aIsGemini = aLower.includes('gemini');
            const bIsGemini = bLower.includes('gemini');
            const aIsGPT = aLower.includes('gpt');
            const bIsGPT = bLower.includes('gpt');

            // Group by provider: Gemini > GPT > Others
            if (aIsGemini && !bIsGemini) return -1;
            if (!aIsGemini && bIsGemini) return 1;
            if (aIsGPT && !bIsGPT && !bIsGemini) return -1;
            if (!aIsGPT && bIsGPT && !aIsGemini) return 1;

            // Within same provider, sort by version (descending)
            // Extract version numbers for comparison
            const extractVersion = (id: string): number[] => {
                const match = id.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
                if (!match) return [0, 0, 0];
                return [
                    parseInt(match[1] || '0'),
                    parseInt(match[2] || '0'),
                    parseInt(match[3] || '0')
                ];
            };

            const aVersion = extractVersion(aLower);
            const bVersion = extractVersion(bLower);

            for (let i = 0; i < 3; i++) {
                if (aVersion[i] !== bVersion[i]) {
                    return bVersion[i] - aVersion[i]; // Descending order
                }
            }

            // If versions are equal, sort alphabetically
            return a.id.localeCompare(b.id);
        });
    }

    /**
     * Get models that support text output, filtered by keywords
     * For Yunwu: only filter by keywords (no outputModalities check)
     * Excludes non-text models (audio, tts, image, etc.)
     * Filters out old versions (GPT < 4.0, Gemini < 2.5)
     */
    private getTextModels(): OpenRouterModel[] {
        const provider = this.plugin.settings.apiProvider;
        const isYunwu = provider === 'yunwu';
        const isGemini = provider === 'gemini';
        const isGptGod = provider === 'gptgod';

        let filtered = this.modelCache.filter(m => {
            const idLower = m.id.toLowerCase();

            // For OpenRouter/Yunwu/GPTGod, must support text output; for Gemini, skip this check (hardcoded)
            // Note: GPTGod might not return modalities, so we treat it like Yunwu (relaxed check)
            if (!isYunwu && !isGemini && !isGptGod && !m.outputModalities.includes('text')) return false;

            // Exclude non-text models by keywords
            if (CanvasAISettingTab.TEXT_MODEL_EXCLUDE_KEYWORDS.some(kw => idLower.includes(kw))) {
                return false;
            }

            // Filter by keywords (case-insensitive)
            if (!CanvasAISettingTab.TEXT_MODEL_KEYWORDS.some(kw => idLower.includes(kw))) {
                return false;
            }

            // Version filtering
            return this.meetsMinimumVersion(m.id);
        });

        // Sort models
        return this.sortModels(filtered);
    }

    /**
     * Get models that support image output, filtered by keywords
     * For Yunwu: only filter by keywords (no outputModalities check)
     * Must contain BOTH 'gemini' AND 'image' in the model ID
     * Filters out old versions (Gemini < 2.5)
     */
    private getImageModels(): OpenRouterModel[] {
        const provider = this.plugin.settings.apiProvider;
        const isYunwu = provider === 'yunwu';
        const isGemini = provider === 'gemini';
        const isGptGod = provider === 'gptgod';

        let filtered = this.modelCache.filter(m => {
            const idLower = m.id.toLowerCase();

            // For OpenRouter/Yunwu/GPTGod, must support image output; for Gemini, skip this check
            if (!isYunwu && !isGemini && !isGptGod && !m.outputModalities.includes('image')) return false;

            // Must contain both 'gemini' AND 'image' (case-insensitive)
            if (!idLower.includes('gemini') || !idLower.includes('image')) {
                return false;
            }

            // Version filtering
            return this.meetsMinimumVersion(m.id);
        });

        // Sort models
        return this.sortModels(filtered);
    }

    async display(): Promise<void> {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass('canvas-ai-settings');

        containerEl.createEl('h2', { text: t('SettingTitle') });



        // ========== API Provider Selection ==========
        containerEl.createEl('h3', { text: t('API Configuration') });

        new Setting(containerEl)
            .setName(t('API Provider'))
            .setDesc(t('Select API Provider'))
            .addDropdown(dropdown => dropdown
                .addOption('gemini', 'Google Gemini')
                .addOption('openrouter', 'OpenRouter')
                .addOption('yunwu', 'Yunwu')
                .addOption('gptgod', 'GPTGod')
                .setValue(this.plugin.settings.apiProvider)
                .onChange(async (value) => {
                    this.plugin.settings.apiProvider = value as ApiProvider;
                    await this.plugin.saveSettings();

                    // Auto-refresh models when switching provider (Non-blocking)
                    this.modelsFetched = false;
                    this.fetchModels(); // Fire and forget

                    // Re-render immediately to show/hide provider-specific settings
                    this.display();
                }));

        const provider = this.plugin.settings.apiProvider;
        const isYunwu = provider === 'yunwu';

        const isGemini = provider === 'gemini';
        const isGptGod = provider === 'gptgod';

        // ========== Configuration Section ==========
        if (provider === 'openrouter') {
            // API Key with Test Button
            const apiKeySetting = new Setting(containerEl)
                .setName(t('OpenRouter API Key'))
                .setDesc(t('Enter your OpenRouter API Key'))
                .addText(text => text
                    .setPlaceholder('sk-or-v1-...')
                    .setValue(this.plugin.settings.openRouterApiKey)
                    .onChange(async (value) => {
                        this.plugin.settings.openRouterApiKey = value;
                        await this.plugin.saveSettings();
                    }));

            this.addTestButton(apiKeySetting.controlEl, containerEl);

            new Setting(containerEl)
                .setName(t('API Base URL'))
                .setDesc(t('API Base URL'))
                .addText(text => text
                    .setPlaceholder('https://openrouter.ai/api/v1/chat/completions')
                    .setValue(this.plugin.settings.openRouterBaseUrl)
                    .onChange(async (value) => {
                        this.plugin.settings.openRouterBaseUrl = value;
                        await this.plugin.saveSettings();
                    }));
        } else if (provider === 'yunwu') {
            const yunwuKeySetting = new Setting(containerEl)
                .setName(t('Yunwu API Key'))
                .setDesc(t('Enter your Yunwu API Key'))
                .addText(text => text
                    .setPlaceholder('sk-...')
                    .setValue(this.plugin.settings.yunwuApiKey)
                    .onChange(async (value) => {
                        this.plugin.settings.yunwuApiKey = value;
                        await this.plugin.saveSettings();
                    }));

            this.addTestButton(yunwuKeySetting.controlEl, containerEl);

            new Setting(containerEl)
                .setName(t('Yunwu Base URL'))
                .setDesc(t('Yunwu Base URL'))
                .addText(text => text
                    .setPlaceholder('https://yunwu.ai')
                    .setValue(this.plugin.settings.yunwuBaseUrl)
                    .onChange(async (value) => {
                        this.plugin.settings.yunwuBaseUrl = value;
                        await this.plugin.saveSettings();
                    }));
        } else if (provider === 'gemini') {
            const geminiKeySetting = new Setting(containerEl)
                .setName(t('Gemini API Key'))
                .setDesc(t('Enter your Gemini API Key'))
                .addText(text => text
                    .setPlaceholder('AIza...')
                    .setValue(this.plugin.settings.geminiApiKey)
                    .onChange(async (value) => {
                        this.plugin.settings.geminiApiKey = value;
                        await this.plugin.saveSettings();
                    }));

            this.addTestButton(geminiKeySetting.controlEl, containerEl);
        } else if (provider === 'gptgod') {
            const gptGodKeySetting = new Setting(containerEl)
                .setName(t('GPTGod API Key'))
                .setDesc(t('Enter your GPTGod API Key'))
                .addText(text => text
                    .setPlaceholder('sk-...')
                    .setValue(this.plugin.settings.gptGodApiKey)
                    .onChange(async (value) => {
                        this.plugin.settings.gptGodApiKey = value;
                        await this.plugin.saveSettings();
                    }));

            this.addTestButton(gptGodKeySetting.controlEl, containerEl);

            new Setting(containerEl)
                .setName(t('API Base URL'))
                .setDesc(t('API Base URL'))
                .addText(text => text
                    .setPlaceholder('https://api.gptgod.online')
                    .setValue(this.plugin.settings.gptGodBaseUrl)
                    .onChange(async (value) => {
                        this.plugin.settings.gptGodBaseUrl = value;
                        await this.plugin.saveSettings();
                        this.plugin.apiManager?.updateSettings(this.plugin.settings);
                    }));
        }

        // ========== 模型配置区域 ==========
        containerEl.createEl('h3', { text: t('Model Configuration') });

        // Fetch models if not already fetched (Non-blocking)
        // For Gemini, use hardcoded list; for OpenRouter/Yunwu, fetch from API
        const apiKey = isGemini
            ? this.plugin.settings.geminiApiKey
            : isYunwu
                ? this.plugin.settings.yunwuApiKey
                : isGptGod
                    ? this.plugin.settings.gptGodApiKey
                    : this.plugin.settings.openRouterApiKey;
        if (!this.modelsFetched && apiKey && !this.isFetching) {
            this.fetchModels();
        }

        // Refresh button - show status for all providers
        let statusText = t('Click refresh');
        if (this.isFetching) {
            statusText = t('Fetching...');
        } else if (this.modelsFetched) {
            const source = isGemini ? 'Gemini (Hardcoded)' : isYunwu ? 'Yunwu' : isGptGod ? 'GPTGod' : 'OpenRouter';
            statusText = t('Loaded models', {
                count: this.modelCache.length,
                textCount: this.getTextModels().length,
                imageCount: this.getImageModels().length,
                source: source
            });
        }

        const refreshSetting = new Setting(containerEl)
            .setName(t('Model List'))
            .setDesc(statusText);

        // Only show refresh button for OpenRouter/Yunwu (not Gemini)
        if (!isGemini) {
            const refreshBtn = refreshSetting.controlEl.createEl('button', {
                text: this.isFetching ? t('Refreshing...') : t('Refresh Model List'),
                cls: 'canvas-ai-refresh-btn'
            });

            refreshBtn.disabled = this.isFetching;

            refreshBtn.addEventListener('click', async () => {
                refreshBtn.textContent = 'Fetching...';
                refreshBtn.disabled = true;
                this.modelsFetched = false; // Force refresh
                this.fetchModels(); // Fire and forget
                // UI will be updated by fetchModels finally block
            });
        }

        // ========== Quick Switch Models (Compact Display) ==========
        this.renderQuickSwitchCompact(containerEl, provider);

        // ========== Text Model Setting ==========
        // Get model keys based on provider
        // Get model keys based on provider
        const textModelKey = isGemini ? 'geminiTextModel' : isYunwu ? 'yunwuTextModel' : isGptGod ? 'gptGodTextModel' : 'openRouterTextModel';
        const textCustomKey = isGemini ? 'geminiUseCustomTextModel' : isYunwu ? 'yunwuUseCustomTextModel' : isGptGod ? 'gptGodUseCustomTextModel' : 'openRouterUseCustomTextModel';
        const textPlaceholder = isGemini ? 'gemini-2.5-flash' : isYunwu ? 'gemini-2.5-flash' : isGptGod ? 'gemini-2.5-flash' : 'google/gemini-2.5-flash';


        this.renderModelSetting(containerEl, {
            name: t('Text Generation Model'),
            desc: t('Text Generation Model'), // Reusing key as desc
            modelKey: textModelKey,
            customKey: textCustomKey,
            placeholder: textPlaceholder,
            getModels: () => this.getTextModels()
        });

        // ========== Image Model Setting ==========
        // ========== Image Model Setting ==========
        const imageModelKey = isGemini ? 'geminiImageModel' : isYunwu ? 'yunwuImageModel' : isGptGod ? 'gptGodImageModel' : 'openRouterImageModel';
        const imageCustomKey = isGemini ? 'geminiUseCustomImageModel' : isYunwu ? 'yunwuUseCustomImageModel' : isGptGod ? 'gptGodUseCustomImageModel' : 'openRouterUseCustomImageModel';
        const imagePlaceholder = isGemini ? 'gemini-3-pro-image-preview' : isYunwu ? 'gemini-3-pro-image-preview' : isGptGod ? 'gemini-3-pro-image-preview' : 'google/gemini-3-pro-image-preview';

        this.renderModelSetting(containerEl, {
            name: t('Image Generation Model'),
            desc: t('Image Generation Model'),
            modelKey: imageModelKey,
            customKey: imageCustomKey,
            placeholder: imagePlaceholder,
            getModels: () => this.getImageModels(),
            isImageModel: true
        });

        // 图片优化区域
        containerEl.createEl('h3', { text: t('Image Optimization') });

        new Setting(containerEl)
            .setName(t('Image Compression Quality'))
            .setDesc(t('Image Compression Quality'))
            .addSlider(slider => slider
                .setLimits(1, 100, 1)
                .setValue(this.plugin.settings.imageCompressionQuality)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.imageCompressionQuality = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t('Image Max Size'))
            .setDesc(t('Image Max Size'))
            .addText(text => text
                .setPlaceholder('2048')
                .setValue(String(this.plugin.settings.imageMaxSize))
                .onChange(async (value) => {
                    const num = parseInt(value);
                    if (!isNaN(num) && num > 0) {
                        this.plugin.settings.imageMaxSize = num;
                        await this.plugin.saveSettings();
                    }
                })
                .inputEl.addClass('canvas-ai-small-input'));

        // ========== Prompt Settings ==========
        containerEl.createEl('h3', { text: t('Prompt Settings') });

        // Chat System Prompt
        new Setting(containerEl)
            .setName(t('Chat System Prompt'))
            .setDesc(t('System prompt for text chat mode'))
            .addTextArea(text => text
                .setPlaceholder('You are a helpful AI assistant...')
                .setValue(this.plugin.settings.chatSystemPrompt)
                .onChange(async (value) => {
                    this.plugin.settings.chatSystemPrompt = value;
                    await this.plugin.saveSettings();
                }));

        // Make the text area larger
        let textAreaEl = containerEl.querySelector('.setting-item:last-child textarea');
        if (textAreaEl) {
            (textAreaEl as HTMLTextAreaElement).rows = 3;
            (textAreaEl as HTMLTextAreaElement).style.width = '100%';
        }

        // Node System Prompt
        new Setting(containerEl)
            .setName(t('Node System Prompt'))
            .setDesc(t('System prompt for node mode (leave empty to use default built-in prompt)'))
            .addTextArea(text => text
                .setPlaceholder('Leave empty to use default Canvas JSON generation prompt...')
                .setValue(this.plugin.settings.nodeSystemPrompt)
                .onChange(async (value) => {
                    this.plugin.settings.nodeSystemPrompt = value;
                    await this.plugin.saveSettings();
                }));

        textAreaEl = containerEl.querySelector('.setting-item:last-child textarea');
        if (textAreaEl) {
            (textAreaEl as HTMLTextAreaElement).rows = 3;
            (textAreaEl as HTMLTextAreaElement).style.width = '100%';
        }

        // Node Default Color
        new Setting(containerEl)
            .setName(t('Node Default Color'))
            .setDesc(t('Override color for generated nodes (1-6, leave empty to use LLM suggested colors)'))
            .addDropdown(dropdown => dropdown
                .addOption('', t('Use LLM colors'))
                .addOption('1', '1 - Red')
                .addOption('2', '2 - Orange')
                .addOption('3', '3 - Yellow')
                .addOption('4', '4 - Green')
                .addOption('5', '5 - Cyan')
                .addOption('6', '6 - Purple')
                .setValue(this.plugin.settings.nodeDefaultColor)
                .onChange(async (value) => {
                    this.plugin.settings.nodeDefaultColor = value;
                    await this.plugin.saveSettings();
                }));

        // Image System Prompt
        new Setting(containerEl)
            .setName(t('Image System Prompt'))
            .setDesc(t('System prompt for image generation mode'))
            .addTextArea(text => text
                .setPlaceholder('You are an expert creator...')
                .setValue(this.plugin.settings.imageSystemPrompt)
                .onChange(async (value) => {
                    this.plugin.settings.imageSystemPrompt = value;
                    await this.plugin.saveSettings();
                }));

        // Make the text area larger
        textAreaEl = containerEl.querySelector('.setting-item:last-child textarea');
        if (textAreaEl) {
            (textAreaEl as HTMLTextAreaElement).rows = 3;
            (textAreaEl as HTMLTextAreaElement).style.width = '100%';
        }

        // ========== Developer Options ==========
        containerEl.createEl('h3', { text: t('Developer Options') });

        new Setting(containerEl)
            .setName(t('Debug Mode'))
            .setDesc(t('Debug Mode'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.debugMode)
                .onChange(async (value) => {
                    this.plugin.settings.debugMode = value;
                    await this.plugin.saveSettings();
                    // Sync debug button visibility in floating palette
                    this.plugin.floatingPalette?.setDebugMode(value);
                    // Re-render settings to show/hide experimental options
                    this.display();
                }));

        new Setting(containerEl)
            .setName(t('Image Generation Timeout'))
            .setDesc(t('Image Generation Timeout Desc'))
            .addText(text => text
                .setPlaceholder('120')
                .setValue(String(this.plugin.settings.imageGenerationTimeout || 120))
                .onChange(async (value) => {
                    const num = parseInt(value);
                    if (!isNaN(num) && num > 0) {
                        this.plugin.settings.imageGenerationTimeout = num;
                        await this.plugin.saveSettings();
                    }
                }))
            .then(setting => {
                // Make the input narrower
                const inputEl = setting.controlEl.querySelector('input');
                if (inputEl) {
                    (inputEl as HTMLInputElement).style.width = '80px';
                    (inputEl as HTMLInputElement).type = 'number';
                    (inputEl as HTMLInputElement).min = '10';
                    (inputEl as HTMLInputElement).max = '600';
                }
            });

    }


    /**
     * Helper to add test button
     */
    private addTestButton(parentEl: HTMLElement, resultContainer: HTMLElement) {
        const testBtn = parentEl.createEl('button', {
            text: t('Test Connection'),
            cls: 'canvas-ai-test-btn'
        });

        const testResultEl = resultContainer.createDiv({ cls: 'canvas-ai-test-result' });
        testResultEl.style.display = 'none';

        testBtn.addEventListener('click', async () => {
            testBtn.textContent = t('Testing...');
            testBtn.disabled = true;
            testResultEl.style.display = 'none';

            try {
                const apiManager = new ApiManager(this.plugin.settings);
                if (!apiManager.isConfigured()) {
                    throw new Error('Please enter API Key first');
                }
                const response = await apiManager.chatCompletion('Say "Connection successful!" in one line.');

                testBtn.textContent = t('Success');
                testBtn.addClass('success');
                testResultEl.textContent = `✓ ${t('Connection successful')}: ${response.substring(0, 50)}...`;
                testResultEl.removeClass('error');
                testResultEl.addClass('success');
                testResultEl.style.display = 'block';

                setTimeout(() => {
                    testBtn.textContent = t('Test Connection');
                    testBtn.removeClass('success');
                }, 3000);
            } catch (error: any) {
                testBtn.textContent = t('Failed');
                testBtn.addClass('error');
                testResultEl.textContent = `✗ ${t('Connection failed')}: ${error.message}`;
                testResultEl.removeClass('success');
                testResultEl.addClass('error');
                testResultEl.style.display = 'block';

                setTimeout(() => {
                    testBtn.textContent = t('Test Connection');
                    testBtn.removeClass('error');
                }, 3000);
            } finally {
                testBtn.disabled = false;
            }
        });
    }

    /**
     * Render quick switch models as compact inline tags with drag-and-drop reordering
     */
    private renderQuickSwitchCompact(containerEl: HTMLElement, currentProvider: string): void {
        const textModels = this.plugin.settings.quickSwitchTextModels || [];
        const imageModels = this.plugin.settings.quickSwitchImageModels || [];

        // Helper to format provider name with proper capitalization
        const formatProviderName = (provider: string): string => {
            switch (provider.toLowerCase()) {
                case 'openrouter': return 'OpenRouter';
                case 'yunwu': return 'Yunwu';
                case 'gemini': return 'Gemini';
                case 'gptgod': return 'GPTGod';
                default: return provider.charAt(0).toUpperCase() + provider.slice(1);
            }
        };

        // Helper to create draggable tag
        const createDraggableTag = (
            container: HTMLElement,
            model: QuickSwitchModel,
            index: number,
            models: QuickSwitchModel[],
            isTextModel: boolean
        ) => {
            const tag = container.createSpan({ cls: 'canvas-ai-quick-switch-tag' });
            tag.setAttribute('draggable', 'true');
            tag.dataset.index = String(index);

            // Format: "ModelName | Provider"
            tag.createSpan({ text: `${model.displayName} | ${formatProviderName(model.provider)}` });
            const removeBtn = tag.createSpan({ text: ' ×', cls: 'canvas-ai-quick-switch-remove' });

            // Remove button click
            removeBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                models.splice(index, 1);
                if (isTextModel) {
                    this.plugin.settings.quickSwitchTextModels = models;
                } else {
                    this.plugin.settings.quickSwitchImageModels = models;
                }
                await this.plugin.saveSettings();
                this.plugin.floatingPalette?.initQuickSwitchModels(
                    this.plugin.settings.quickSwitchTextModels || [],
                    this.plugin.settings.quickSwitchImageModels || [],
                    this.plugin.settings.paletteTextModel || '',
                    this.plugin.settings.paletteImageModel || '',
                    this.plugin.settings.paletteNodeModel || ''
                );
                new Notice(t('Model removed'));
                this.display();
            });

            // Drag events
            tag.addEventListener('dragstart', (e) => {
                tag.addClass('dragging');
                e.dataTransfer?.setData('text/plain', String(index));
            });

            tag.addEventListener('dragend', () => {
                tag.removeClass('dragging');
            });

            tag.addEventListener('dragover', (e) => {
                e.preventDefault();
                tag.addClass('drag-over');
            });

            tag.addEventListener('dragleave', () => {
                tag.removeClass('drag-over');
            });

            tag.addEventListener('drop', async (e) => {
                e.preventDefault();
                tag.removeClass('drag-over');
                const fromIndex = parseInt(e.dataTransfer?.getData('text/plain') || '-1');
                const toIndex = index;
                if (fromIndex >= 0 && fromIndex !== toIndex) {
                    // Reorder array
                    const [moved] = models.splice(fromIndex, 1);
                    models.splice(toIndex, 0, moved);
                    if (isTextModel) {
                        this.plugin.settings.quickSwitchTextModels = models;
                    } else {
                        this.plugin.settings.quickSwitchImageModels = models;
                    }
                    await this.plugin.saveSettings();
                    this.plugin.floatingPalette?.initQuickSwitchModels(
                        this.plugin.settings.quickSwitchTextModels || [],
                        this.plugin.settings.quickSwitchImageModels || [],
                        this.plugin.settings.paletteTextModel || '',
                        this.plugin.settings.paletteImageModel || '',
                        this.plugin.settings.paletteNodeModel || ''
                    );
                    this.display();
                }
            });
        };

        // Text/Node models row
        const textRow = containerEl.createDiv({ cls: 'canvas-ai-quick-switch-row' });
        textRow.createSpan({ text: `${t('Quick Switch Text Models')}: `, cls: 'canvas-ai-quick-switch-label' });
        const textTagsContainer = textRow.createSpan({ cls: 'canvas-ai-quick-switch-tags' });

        if (textModels.length === 0) {
            textTagsContainer.createSpan({ text: t('No quick switch models'), cls: 'canvas-ai-quick-switch-empty' });
        } else {
            textModels.forEach((model, index) => {
                createDraggableTag(textTagsContainer, model, index, textModels, true);
            });
        }

        // Image models row
        const imageRow = containerEl.createDiv({ cls: 'canvas-ai-quick-switch-row' });
        imageRow.createSpan({ text: `${t('Quick Switch Image Models')}: `, cls: 'canvas-ai-quick-switch-label' });
        const imageTagsContainer = imageRow.createSpan({ cls: 'canvas-ai-quick-switch-tags' });

        if (imageModels.length === 0) {
            imageTagsContainer.createSpan({ text: t('No quick switch models'), cls: 'canvas-ai-quick-switch-empty' });
        } else {
            imageModels.forEach((model, index) => {
                createDraggableTag(imageTagsContainer, model, index, imageModels, false);
            });
        }
    }

    /**
     * Get current text model ID based on provider
     */
    private getCurrentTextModelId(): string {
        const provider = this.plugin.settings.apiProvider;
        switch (provider) {
            case 'openrouter':
                return this.plugin.settings.openRouterTextModel;
            case 'yunwu':
                return this.plugin.settings.yunwuTextModel;
            case 'gemini':
                return this.plugin.settings.geminiTextModel;
            case 'gptgod':
                return this.plugin.settings.gptGodTextModel;
            default:
                return '';
        }
    }

    /**
     * Get current image model ID based on provider
     */
    private getCurrentImageModelId(): string {
        const provider = this.plugin.settings.apiProvider;
        switch (provider) {
            case 'openrouter':
                return this.plugin.settings.openRouterImageModel;
            case 'yunwu':
                return this.plugin.settings.yunwuImageModel;
            case 'gemini':
                return this.plugin.settings.geminiImageModel;
            case 'gptgod':
                return this.plugin.settings.gptGodImageModel;
            default:
                return '';
        }
    }

    /**
     * Get display name for a model ID (from cache or format from ID)
     */
    private getModelDisplayName(modelId: string): string {
        // Try to find in model cache
        const cached = this.modelCache.find(m => m.id === modelId);
        if (cached) {
            // Remove company prefix like "Google: " if present
            const name = cached.name;
            const colonIndex = name.indexOf(': ');
            if (colonIndex > -1 && colonIndex < 20) {
                return name.substring(colonIndex + 2);
            }
            return name;
        }
        // Fallback: format the model ID nicely
        return modelId.split('/').pop() || modelId;
    }

    /**
     * Render a model selection setting with dropdown/text input toggle
     */
    private renderModelSetting(containerEl: HTMLElement, options: {
        name: string;
        desc: string;
        modelKey: keyof CanvasAISettings;
        customKey: keyof CanvasAISettings;
        placeholder: string;
        getModels: () => OpenRouterModel[];
        isImageModel?: boolean;
    }): void {
        const { name, desc, modelKey, customKey, placeholder, getModels, isImageModel } = options;

        const useCustom = this.plugin.settings[customKey] as boolean;
        const models = getModels();
        const hasModels = models.length > 0;
        const isManualMode = useCustom || !hasModels;

        // 1. Model Selection (Dropdown or Input)
        const modelSetting = new Setting(containerEl)
            .setName(name)
            .setDesc(desc);

        if (isManualMode) {
            // Manual Input Mode
            modelSetting.addText(text => text
                .setPlaceholder(placeholder)
                .setValue((this.plugin.settings[modelKey] as string) || '')
                .onChange(async (value) => {
                    (this.plugin.settings[modelKey] as string) = value;
                    await this.plugin.saveSettings();
                }));

            if (!hasModels && !useCustom) {
                modelSetting.descEl.createEl('div', {
                    text: t('No models available'),
                    cls: 'canvas-ai-model-hint',
                    attr: { style: 'color: var(--text-muted); font-size: 0.8em;' }
                });
            }
        } else {
            // Dropdown Mode
            modelSetting.addDropdown(dropdown => {
                const currentValue = (this.plugin.settings[modelKey] as string);

                // Add current value first if not in list (to preserve custom values)
                const modelIds = models.map(m => m.id);
                if (currentValue && !modelIds.includes(currentValue)) {
                    dropdown.addOption(currentValue, `${currentValue} (Current)`);
                }

                // Add all models from API
                for (const model of models) {
                    dropdown.addOption(model.id, `${model.name} (${model.id})`);
                }

                dropdown.setValue(currentValue || '');
                dropdown.onChange(async (value) => {
                    (this.plugin.settings[modelKey] as string) = value;
                    await this.plugin.saveSettings();
                });
            });
        }

        // 2. Manual Input Toggle + Add to Quick Switch Button (Same Line)
        const toggleSetting = new Setting(containerEl)
            .setName(t('Manually Enter Model Name'))
            .setDesc(isManualMode ? t('Disable Manual Model') : t('Enable Manual Model'))
            .addToggle(toggle => toggle
                .setValue(useCustom || false)
                .onChange(async (value) => {
                    (this.plugin.settings[customKey] as boolean) = value;
                    await this.plugin.saveSettings();
                    // Re-render to switch between dropdown and text input
                    this.display();
                }));

        // Add "Add to Quick Switch" button
        const provider = this.plugin.settings.apiProvider;
        const currentModelId = this.plugin.settings[modelKey] as string;
        if (currentModelId) {
            toggleSetting.addButton(btn => btn
                .setButtonText(t('Add to Quick Switch'))
                .onClick(async () => {
                    const targetList = isImageModel
                        ? (this.plugin.settings.quickSwitchImageModels || [])
                        : (this.plugin.settings.quickSwitchTextModels || []);

                    const key = `${provider}|${currentModelId}`;
                    if (targetList.some(m => `${m.provider}|${m.modelId}` === key)) {
                        new Notice(t('Model already exists'));
                        return;
                    }

                    targetList.push({
                        provider: provider,
                        modelId: currentModelId,
                        displayName: this.getModelDisplayName(currentModelId)
                    });

                    if (isImageModel) {
                        this.plugin.settings.quickSwitchImageModels = targetList;
                    } else {
                        this.plugin.settings.quickSwitchTextModels = targetList;
                    }

                    await this.plugin.saveSettings();
                    this.plugin.floatingPalette?.initQuickSwitchModels(
                        this.plugin.settings.quickSwitchTextModels || [],
                        this.plugin.settings.quickSwitchImageModels || [],
                        this.plugin.settings.paletteTextModel || '',
                        this.plugin.settings.paletteImageModel || '',
                        this.plugin.settings.paletteNodeModel || ''
                    );
                    new Notice(t('Model added'));
                    this.display();
                }));
        }
    }
}

