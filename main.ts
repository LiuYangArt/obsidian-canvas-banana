import { App, ItemView, Modal, Notice, Plugin, PluginSettingTab, Setting, setIcon, setTooltip, TFile, Scope } from 'obsidian';
import type { Canvas, CanvasNode, CanvasCoords } from './types';
import { CanvasConverter, ConvertedNode } from './canvas-converter';
import { ApiManager } from './api-manager';
import { IntentResolver, ResolvedIntent } from './intent-resolver';

// ========== 插件设置接口 ==========
export type ApiProvider = 'openrouter' | 'yunwu';

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

    // Debug mode
    debugMode: boolean;

    // Image generation system prompt
    imageSystemPrompt: string;

    // Prompt presets - separate for chat and image modes
    chatPresets: PromptPreset[];
    imagePresets: PromptPreset[];
}

const DEFAULT_SETTINGS: CanvasAISettings = {
    apiProvider: 'openrouter',

    openRouterApiKey: '',
    openRouterBaseUrl: 'https://openrouter.ai/api/v1/chat/completions',
    openRouterTextModel: 'google/gemini-2.0-flash-001',
    openRouterImageModel: 'google/gemini-2.0-flash-001', // Placeholder default
    openRouterUseCustomTextModel: false,
    openRouterUseCustomImageModel: false,

    yunwuApiKey: '',
    yunwuBaseUrl: 'https://yunwu.ai',
    yunwuTextModel: 'gemini-2.0-flash',
    yunwuImageModel: 'gemini-3-pro-image-preview',
    yunwuUseCustomTextModel: false,
    yunwuUseCustomImageModel: false,

    imageCompressionQuality: 80,  // Default 80% quality
    imageMaxSize: 2048,  // Default max size
    defaultAspectRatio: '1:1',
    defaultResolution: '1K',

    debugMode: false,

    imageSystemPrompt: 'Role: A Professional Image Creator. Use the following references for image creation.',

    chatPresets: [],
    imagePresets: []
};


// ========== Prompt Preset Interface ==========
export interface PromptPreset {
    id: string;      // UUID
    name: string;    // Display name
    prompt: string;  // Prompt content
}

// ========== 悬浮面板模式 ==========
type PaletteMode = 'chat' | 'image';

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

        const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelBtn.addEventListener('click', () => this.close());

        const submitBtn = buttonContainer.createEl('button', { text: 'OK', cls: 'mod-cta' });
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
        contentEl.createEl('h3', { text: 'Confirm Delete' });
        contentEl.createEl('p', { text: this.message });

        const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });

        const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelBtn.addEventListener('click', () => this.close());

        const deleteBtn = buttonContainer.createEl('button', { text: 'Delete', cls: 'mod-warning' });
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

// ========== 悬浮面板组件 ==========
class FloatingPalette {
    private containerEl: HTMLElement;
    private currentMode: PaletteMode = 'chat';
    private promptInput: HTMLTextAreaElement;
    private isVisible: boolean = false;
    private currentParent: HTMLElement | null = null;
    private onClose: (() => void) | null = null;
    private onDebug: (() => void) | null = null;
    private onGenerate: ((prompt: string, mode: PaletteMode) => Promise<void>) | null = null;
    private onSettingsChange: ((key: 'aspectRatio' | 'resolution', value: string) => void) | null = null;
    private apiManager: ApiManager;
    private pendingTaskCount: number = 0;
    // Image generation options (no model selection - always use Pro)
    private imageAspectRatio: string = '1:1';
    private imageResolution: string = '1K';

    // DOM references for image options
    private imageOptionsEl: HTMLElement | null = null;
    private ratioSelect: HTMLSelectElement | null = null;
    private resolutionSelect: HTMLSelectElement | null = null;
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
    private onPresetChange: ((presets: PromptPreset[], mode: PaletteMode) => void) | null = null;
    private app: App;
    private scope: Scope;

    constructor(app: App, apiManager: ApiManager, onDebugCallback?: () => void) {
        this.app = app;
        this.apiManager = apiManager;
        this.onDebug = onDebugCallback || null;
        this.scope = new Scope(this.app.scope);
        this.scope = new Scope(this.app.scope);
        // We push a scope to tell Obsidian we are in a different context,
        // but we don't register specific blockers that return false because
        // that would prevent the default behavior (typing/cursor movement) of the textarea.
        // Instead, we rely on stopping propagation at the DOM level.

        this.containerEl = this.createPaletteDOM();
        this.promptInput = this.containerEl.querySelector('.canvas-ai-prompt-input') as HTMLTextAreaElement;

        // Manage Scope on focus/blur
        this.promptInput.addEventListener('focus', () => {
            this.app.keymap.pushScope(this.scope);
        });

        this.promptInput.addEventListener('blur', () => {
            this.app.keymap.popScope(this.scope);
        });
    }

    /**
     * Set the generate callback
     */
    setOnGenerate(callback: (prompt: string, mode: PaletteMode) => Promise<void>): void {
        this.onGenerate = callback;
    }

    /**
     * Set the settings change callback for persisting image options
     */
    setOnSettingsChange(callback: (key: 'aspectRatio' | 'resolution', value: string) => void): void {
        this.onSettingsChange = callback;
    }

    /**
     * Initialize image options from saved settings
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
            this.debugBtnEl.style.display = enabled ? 'block' : 'none';
        }
    }

    /**
     * Set version info text dynamically
     */
    setVersion(version: string): void {
        if (this.versionInfoEl) {
            this.versionInfoEl.textContent = `🍌CanvasBanana by LiuYang v${version}`;
        }
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
                    <button class="canvas-ai-tab active" data-mode="chat">Chat</button>
                    <button class="canvas-ai-tab" data-mode="image">Image</button>
                </div>
                <button class="canvas-ai-close-btn">×</button>
            </div>
            <div class="canvas-ai-palette-body">
                <div class="canvas-ai-preset-row">
                    <select class="canvas-ai-preset-select dropdown">
                        <option value="">Select prompt preset</option>
                    </select>
                    <div class="canvas-ai-preset-actions">
                        <button class="canvas-ai-preset-btn" data-action="add" title="Add preset"></button>
                        <button class="canvas-ai-preset-btn" data-action="delete" title="Delete preset"></button>
                        <button class="canvas-ai-preset-btn" data-action="save" title="Save preset"></button>
                        <button class="canvas-ai-preset-btn" data-action="rename" title="Rename preset"></button>
                    </div>
                </div>
                <div class="canvas-ai-image-options" style="display: none;">
                    <div class="canvas-ai-option-row">
                        <span class="canvas-ai-option-group">
                            <label>Resolution</label>
                            <select class="canvas-ai-resolution-select dropdown">
                                <option value="1K">1K</option>
                                <option value="2K">2K</option>
                                <option value="4K">4K</option>
                            </select>
                        </span>
                        <span class="canvas-ai-option-group">
                            <label>Ratio</label>
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
                </div>
                <textarea 
                    class="canvas-ai-prompt-input" 
                    placeholder="Ask a question about selected notes..."
                    rows="4"
                ></textarea>
            </div>
            <div class="canvas-ai-palette-footer">
                <div class="canvas-ai-footer-row">
                    <span class="canvas-ai-context-preview"></span>
                    <div class="canvas-ai-btn-group">
                        <button class="canvas-ai-debug-btn" style="display: none;">Debug</button>
                        <button class="canvas-ai-generate-btn">Generate</button>
                    </div>
                </div>
                <div class="canvas-ai-version-info"></div>
            </div>
        `;

        // Get version info element
        this.versionInfoEl = container.querySelector('.canvas-ai-version-info');

        // Get image options DOM references
        this.imageOptionsEl = container.querySelector('.canvas-ai-image-options');
        this.ratioSelect = container.querySelector('.canvas-ai-ratio-select');
        this.resolutionSelect = container.querySelector('.canvas-ai-resolution-select');

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
                const presets = this.currentMode === 'chat' ? this.chatPresets : this.imagePresets;
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
                this.updateImageOptionsVisibility();
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
            this.onDebug?.();
        });

        // 绑定生成按钮
        const generateBtn = container.querySelector('.canvas-ai-generate-btn');
        generateBtn?.addEventListener('click', () => this.handleGenerate());

        // Prevent keyboard events from bubbling to Canvas when textarea is focused
        const promptInput = container.querySelector('.canvas-ai-prompt-input');
        if (promptInput) {
            const stopPropagation = (e: Event) => e.stopPropagation();
            promptInput.addEventListener('keydown', stopPropagation);
            promptInput.addEventListener('keyup', stopPropagation);
            promptInput.addEventListener('keypress', stopPropagation);
        }

        return container;
    }

    /**
     * Show/hide image options based on current mode
     */
    private updateImageOptionsVisibility(): void {
        if (this.imageOptionsEl) {
            this.imageOptionsEl.style.display = this.currentMode === 'image' ? 'flex' : 'none';
        }
    }

    /**
     * Refresh the preset dropdown based on current mode
     */
    private refreshPresetDropdown(): void {
        if (!this.presetSelect) return;

        const presets = this.currentMode === 'chat' ? this.chatPresets : this.imagePresets;

        // Clear existing options except the default
        this.presetSelect.innerHTML = '<option value="">Select prompt preset</option>';

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
            'New Preset',
            'Enter preset name',
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
                } else {
                    this.imagePresets.push(newPreset);
                    this.onPresetChange?.(this.imagePresets, 'image');
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
            new Notice('Please select a preset to delete');
            return;
        }

        const presets = this.currentMode === 'chat' ? this.chatPresets : this.imagePresets;
        const preset = presets.find(p => p.id === selectedId);
        if (!preset) return;

        new ConfirmModal(
            this.app,
            `Are you sure you want to delete "${preset.name}"?`,
            () => {
                if (this.currentMode === 'chat') {
                    this.chatPresets = this.chatPresets.filter(p => p.id !== selectedId);
                    this.onPresetChange?.(this.chatPresets, 'chat');
                } else {
                    this.imagePresets = this.imagePresets.filter(p => p.id !== selectedId);
                    this.onPresetChange?.(this.imagePresets, 'image');
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
            new Notice('Please select a preset to save');
            return;
        }

        const presets = this.currentMode === 'chat' ? this.chatPresets : this.imagePresets;
        const preset = presets.find(p => p.id === selectedId);
        if (!preset) return;

        preset.prompt = this.promptInput.value;

        if (this.currentMode === 'chat') {
            this.onPresetChange?.(this.chatPresets, 'chat');
        } else {
            this.onPresetChange?.(this.imagePresets, 'image');
        }

        new Notice(`Preset "${preset.name}" saved`);
    }

    /**
     * Handle Rename preset button click
     */
    private handlePresetRename(): void {
        const selectedId = this.presetSelect?.value;
        if (!selectedId) {
            new Notice('Please select a preset to rename');
            return;
        }

        const presets = this.currentMode === 'chat' ? this.chatPresets : this.imagePresets;
        const preset = presets.find(p => p.id === selectedId);
        if (!preset) return;

        new InputModal(
            this.app,
            'Rename Preset',
            'Enter new name',
            preset.name,
            (newName) => {
                preset.name = newName;

                if (this.currentMode === 'chat') {
                    this.onPresetChange?.(this.chatPresets, 'chat');
                } else {
                    this.onPresetChange?.(this.imagePresets, 'image');
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
    initPresets(chatPresets: PromptPreset[], imagePresets: PromptPreset[]): void {
        this.chatPresets = [...chatPresets];
        this.imagePresets = [...imagePresets];
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
            this.promptInput.placeholder = 'Ask a question about selected notes...';
        } else {
            this.promptInput.placeholder = 'Describe the image, or leave empty to use selected text...';
        }
    }

    /**
     * 更新上下文预览信息
     */
    updateContextPreview(nodeCount: number, imageCount: number, textCount: number, groupCount: number = 0): void {
        const preview = this.containerEl.querySelector('.canvas-ai-context-preview');
        if (preview) {
            if (nodeCount === 0) {
                preview.textContent = '';
            } else {
                const parts: string[] = [];
                if (imageCount > 0) parts.push(`${imageCount} Image`);
                if (textCount > 0) parts.push(`${textCount} Text`);
                if (groupCount > 0) parts.push(`${groupCount} Group`);
                preview.textContent = `🔗 ${nodeCount} Nodes Selected (${parts.join(', ')})`;
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
     * Update generate button text based on pending task count
     */
    private updateGenerateButtonState(): void {
        const generateBtn = this.containerEl.querySelector('.canvas-ai-generate-btn') as HTMLButtonElement;
        if (!generateBtn) return;

        if (this.pendingTaskCount === 0) {
            generateBtn.textContent = 'Generate';
            generateBtn.removeClass('generating');
        } else {
            generateBtn.textContent = `Generating ${this.pendingTaskCount} Task(s)`;
            generateBtn.addClass('generating');
        }
        // Button always stays enabled for multi-task support
        generateBtn.disabled = false;
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

// ========== 插件主类 ==========
export default class CanvasAIPlugin extends Plugin {
    settings: CanvasAISettings;

    private floatingPalette: FloatingPalette | null = null;
    private lastSelectionSize: number = 0;
    private lastSelectedIds: Set<string> = new Set();
    private hideTimer: number | null = null;
    private apiManager: ApiManager | null = null;

    async onload() {
        console.log('Canvas AI: 插件加载中...');

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

        console.log('Canvas AI: 插件加载完成');
    }

    onunload() {
        console.log('Canvas AI: 插件卸载中...');

        // 清理 DOM 组件
        this.floatingPalette?.destroy();

        console.log('Canvas AI: 插件已卸载');
    }

    /**
     * 初始化悬浮组件
     */
    private initFloatingComponents(): void {
        // Initialize API Manager
        this.apiManager = new ApiManager(this.settings);

        this.floatingPalette = new FloatingPalette(this.app, this.apiManager, () => {
            this.debugSelectedNodes();
        });

        // Set up generate callback for Ghost Node creation
        this.floatingPalette.setOnGenerate(async (prompt: string, mode: PaletteMode) => {
            await this.handleGeneration(prompt, mode);
        });

        // Set up settings change callback for persisting image options
        this.floatingPalette.setOnSettingsChange((key, value) => {
            if (key === 'aspectRatio') {
                this.settings.defaultAspectRatio = value;
            } else if (key === 'resolution') {
                this.settings.defaultResolution = value;
            }
            this.saveSettings();
        });

        // Set up preset change callback for persisting presets
        this.floatingPalette.setOnPresetChange((presets, mode) => {
            if (mode === 'chat') {
                this.settings.chatPresets = presets;
            } else {
                this.settings.imagePresets = presets;
            }
            this.saveSettings();
        });

        // Initialize palette with saved settings
        this.floatingPalette.initImageOptions(
            this.settings.defaultAspectRatio,
            this.settings.defaultResolution
        );

        // Initialize presets from saved settings
        this.floatingPalette.initPresets(
            this.settings.chatPresets || [],
            this.settings.imagePresets || []
        );

        // Initialize debug mode from settings
        this.floatingPalette.setDebugMode(this.settings.debugMode);

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
                let systemPrompt = 'You are a helpful AI assistant embedded in an Obsidian Canvas. Answer concisely and use Markdown formatting.';

                if (intent.contextText) {
                    systemPrompt += `\n\n---\nThe user has selected the following content from their canvas:\n\n${intent.contextText}\n\n---\nBased on this context, respond to the user's request.`;
                }

                console.log('Canvas AI: Sending chat request with context');
                if (intent.images.length > 0) {
                    // Convert to simple format for multimodalChat
                    const simpleImages = intent.images.map(img => ({
                        base64: img.base64,
                        mimeType: img.mimeType
                    }));
                    response = await this.apiManager!.multimodalChat(intent.instruction, simpleImages, systemPrompt);
                } else {
                    response = await this.apiManager!.chatCompletion(intent.instruction, systemPrompt);
                }
                console.log('Canvas AI: API Response received');
                this.updateGhostNode(ghostNode, response, false);

            } else {
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
                this.updateGhostNode(ghostNode, '💾 Saving image...', false);

                // Save to Vault
                const savedFile = await this.saveImageToVault(base64Image, intent.instruction);
                console.log('Canvas AI: Image saved to', savedFile.path);

                // Replace Ghost Node with Image Node
                this.replaceGhostWithImageNode(canvas, ghostNode, savedFile);
            }
        } catch (error: any) {
            console.error('Canvas AI: API Error:', error.message || error);
            this.updateGhostNode(ghostNode, `❗ Error: ${error.message || 'Unknown error'}`, true);
        }
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
    }

    /**
     * Create a ghost node (loading placeholder)
     */
    private createGhostNode(canvas: Canvas, x: number, y: number): CanvasNode {
        const node = canvas.createTextNode({
            pos: { x, y, width: 400, height: 100 },
            size: { x, y, width: 400, height: 100 },
            text: '✨ AI Generating...',
            focus: false,
            save: true
        });

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
    private updateGhostNode(node: CanvasNode, content: string, isError: boolean): void {
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

        // 监听活动叶子变化
        this.registerEvent(
            this.app.workspace.on('active-leaf-change', () => {
                this.hideAllFloatingComponents();
            })
        );

        // 监听文件打开（切换文件时隐藏）
        this.registerEvent(
            this.app.workspace.on('file-open', () => {
                this.hideAllFloatingComponents();
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

        // 规则 3: 取消所有选中 -> 面板消失 (防抖处理)
        // 图片节点加选时可能会触发瞬时的 selectionSize === 0，需要防抖
        if (selectionSize === 0) {
            if (this.floatingPalette?.visible && !this.hideTimer) {
                this.hideTimer = window.setTimeout(() => {
                    this.floatingPalette?.hide();
                    this.lastSelectedIds.clear();
                    this.lastSelectionSize = 0;
                    this.hideTimer = null;
                }, 50); // 200ms 缓冲期
            }
            return;
        }

        // 有选中：立即取消正在进行的隐藏倒计时
        if (this.hideTimer) {
            window.clearTimeout(this.hideTimer);
            this.hideTimer = null;
        }

        // 向原生工具条注入按钮
        this.injectAiButtonToPopupMenu(canvas);

        // 如果面板当前是显示状态，检查是否需要自动关闭或更新位置
        if (this.floatingPalette?.visible) {
            // 规则 4: 选中新节点 (无重叠) -> 面板消失
            // (除非上次记录为空，可能是刚初始化)
            if (this.lastSelectedIds.size > 0) {
                let hasOverlap = false;
                for (const id of currentIds) {
                    if (this.lastSelectedIds.has(id)) {
                        hasOverlap = true;
                        break;
                    }
                }

                if (!hasOverlap) {
                    this.floatingPalette.hide();
                    this.lastSelectedIds = currentIds;
                    this.lastSelectionSize = selectionSize;
                    return;
                }
            }

            // 规则 2: 有重叠 (添加/减少选中) -> 更新位置
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
     */
    private countNodeTypes(selection: Set<CanvasNode>): { imageCount: number; textCount: number; groupCount: number } {
        let imageCount = 0;
        let textCount = 0;
        let groupCount = 0;

        selection.forEach(node => {
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
    private async debugSelectedNodes(): Promise<void> {
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
        console.group('🎨 IntentResolver Output (Image Mode Simulation)');
        try {
            const intent = await IntentResolver.resolve(
                this.app,
                canvas,
                selection,
                '',  // 模拟空输入，测试回退策略
                'image',
                this.settings
            );

            console.log('✅ canGenerate:', intent.canGenerate);

            console.group('📷 Images with Roles');
            intent.images.forEach((img, idx) => {
                console.log(`[${idx + 1}] Role: "${img.role}", MimeType: ${img.mimeType}, Base64 Length: ${img.base64.length}`);
            });
            if (intent.images.length === 0) {
                console.log('(No images in selection)');
            }
            console.groupEnd();

            console.group('📝 Instruction (Fallback Result)');
            console.log('Final Instruction:', intent.instruction);
            console.log('Instruction Length:', intent.instruction.length);
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
            const payloadPreview = {
                model: this.settings.imageModel,
                modalities: ['image', 'text'],
                content_structure: [
                    { type: 'text', text: 'You are an expert creator...' },
                    ...intent.images.map(img => [
                        { type: 'text', text: `[Ref: ${img.role}]` },
                        { type: 'image_url', base64_length: img.base64.length }
                    ]).flat(),
                    intent.contextText ? { type: 'text', text: '[Context]...' } : null,
                    { type: 'text', text: `INSTRUCTION: ${intent.instruction.substring(0, 100)}${intent.instruction.length > 100 ? '...' : ''}` }
                ].filter(Boolean)
            };
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

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
        // Update ApiManager settings reference
        this.apiManager?.updateSettings(this.settings);
    }
}

// ========== 设置页面 ==========

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
     */
    private async fetchModels(): Promise<void> {
        if (this.isFetching) return;

        const isYunwu = this.plugin.settings.apiProvider === 'yunwu';
        const apiKey = isYunwu
            ? this.plugin.settings.yunwuApiKey
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
            new Notice(`无法获取模型列表: ${error.message}`);
        } finally {
            this.isFetching = false;
            // Update UI after fetch completes (success or error)
            this.display();
        }
    }

    // Model keyword filters
    private static TEXT_MODEL_KEYWORDS = ['gpt', 'gemini'];
    private static IMAGE_MODEL_KEYWORDS = ['gemini', 'banana'];

    /**
     * Get models that support text output, filtered by keywords
     * For Yunwu: only filter by keywords (no outputModalities check)
     */
    private getTextModels(): OpenRouterModel[] {
        const isYunwu = this.plugin.settings.apiProvider === 'yunwu';
        return this.modelCache.filter(m => {
            // For OpenRouter, must support text output; for Yunwu, skip this check
            if (!isYunwu && !m.outputModalities.includes('text')) return false;
            // Filter by keywords (case-insensitive)
            const idLower = m.id.toLowerCase();
            return CanvasAISettingTab.TEXT_MODEL_KEYWORDS.some(kw => idLower.includes(kw));
        });
    }

    /**
     * Get models that support image output, filtered by keywords
     * For Yunwu: only filter by keywords (no outputModalities check)
     * Must contain BOTH 'gemini' AND 'image' in the model ID
     */
    private getImageModels(): OpenRouterModel[] {
        const isYunwu = this.plugin.settings.apiProvider === 'yunwu';
        return this.modelCache.filter(m => {
            // For OpenRouter, must support image output; for Yunwu, skip this check
            if (!isYunwu && !m.outputModalities.includes('image')) return false;
            // Must contain both 'gemini' AND 'image' (case-insensitive)
            const idLower = m.id.toLowerCase();
            return idLower.includes('gemini') && idLower.includes('image');
        });
    }

    async display(): Promise<void> {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass('canvas-ai-settings');

        containerEl.createEl('h2', { text: 'Canvas AI 设置' });

        // ========== API Provider Selection ==========
        containerEl.createEl('h3', { text: 'API 配置' });

        new Setting(containerEl)
            .setName('API Provider')
            .setDesc('选择 API 服务提供商')
            .addDropdown(dropdown => dropdown
                .addOption('openrouter', 'OpenRouter')
                .addOption('yunwu', 'Yunwu')
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

        const isYunwu = this.plugin.settings.apiProvider === 'yunwu';
        // Yunwu uses same OpenAI-compatible models endpoint

        // ========== Configuration Section ==========
        if (!isYunwu) { // OpenRouter
            // API Key with Test Button
            const apiKeySetting = new Setting(containerEl)
                .setName('OpenRouter API Key')
                .setDesc('输入你的 OpenRouter API 密钥 (获取: openrouter.ai/keys)')
                .addText(text => text
                    .setPlaceholder('sk-or-v1-...')
                    .setValue(this.plugin.settings.openRouterApiKey)
                    .onChange(async (value) => {
                        this.plugin.settings.openRouterApiKey = value;
                        await this.plugin.saveSettings();
                    }));

            this.addTestButton(apiKeySetting.controlEl, containerEl);

            new Setting(containerEl)
                .setName('API Base URL')
                .setDesc('OpenRouter API 端点地址')
                .addText(text => text
                    .setPlaceholder('https://openrouter.ai/api/v1/chat/completions')
                    .setValue(this.plugin.settings.openRouterBaseUrl)
                    .onChange(async (value) => {
                        this.plugin.settings.openRouterBaseUrl = value;
                        await this.plugin.saveSettings();
                    }));
        } else { // Yunwu
            const yunwuKeySetting = new Setting(containerEl)
                .setName('Yunwu API Key')
                .setDesc('输入你的 Yunwu API 密钥')
                .addText(text => text
                    .setPlaceholder('sk-...')
                    .setValue(this.plugin.settings.yunwuApiKey)
                    .onChange(async (value) => {
                        this.plugin.settings.yunwuApiKey = value;
                        await this.plugin.saveSettings();
                    }));

            this.addTestButton(yunwuKeySetting.controlEl, containerEl);

            new Setting(containerEl)
                .setName('Yunwu Base URL')
                .setDesc('Yunwu API 端点地址')
                .addText(text => text
                    .setPlaceholder('https://yunwu.ai')
                    .setValue(this.plugin.settings.yunwuBaseUrl)
                    .onChange(async (value) => {
                        this.plugin.settings.yunwuBaseUrl = value;
                        await this.plugin.saveSettings();
                    }));
        }

        // ========== 模型配置区域 ==========
        containerEl.createEl('h3', { text: '模型配置' });

        // Fetch models if not already fetched (Non-blocking)
        const apiKey = isYunwu ? this.plugin.settings.yunwuApiKey : this.plugin.settings.openRouterApiKey;
        if (!this.modelsFetched && apiKey && !this.isFetching) {
            this.fetchModels();
        }

        // Refresh button
        let statusText = '点击刷新按钮获取可用模型列表';
        if (this.isFetching) {
            statusText = '⏳ 正在获取模型列表...';
        } else if (this.modelsFetched) {
            statusText = `已加载 ${this.modelCache.length} 个模型 (文本: ${this.getTextModels().length}, 图像: ${this.getImageModels().length}) 来自 ${isYunwu ? 'Yunwu' : 'OpenRouter'}`;
        }

        const refreshSetting = new Setting(containerEl)
            .setName('模型列表')
            .setDesc(statusText);

        const refreshBtn = refreshSetting.controlEl.createEl('button', {
            text: this.isFetching ? '刷新中...' : '🔄 刷新模型列表',
            cls: 'canvas-ai-refresh-btn'
        });

        refreshBtn.disabled = this.isFetching;

        refreshBtn.addEventListener('click', async () => {
            refreshBtn.textContent = '获取中...';
            refreshBtn.disabled = true;
            this.modelsFetched = false; // Force refresh
            this.fetchModels(); // Fire and forget
            // UI will be updated by fetchModels finally block
        });

        // ========== Text Model Setting ==========
        this.renderModelSetting(containerEl, {
            name: 'Text Generation Model',
            desc: '用于 Chat 模式的文本生成模型',
            modelKey: isYunwu ? 'yunwuTextModel' : 'openRouterTextModel',
            customKey: isYunwu ? 'yunwuUseCustomTextModel' : 'openRouterUseCustomTextModel',
            placeholder: isYunwu ? 'gemini-2.0-flash' : 'google/gemini-2.0-flash-001',
            getModels: () => this.getTextModels()
        });

        // ========== Image Model Setting ==========
        this.renderModelSetting(containerEl, {
            name: 'Image Generation Model',
            desc: '用于 Image 模式的图像生成模型',
            modelKey: isYunwu ? 'yunwuImageModel' : 'openRouterImageModel',
            customKey: isYunwu ? 'yunwuUseCustomImageModel' : 'openRouterUseCustomImageModel',
            placeholder: isYunwu ? 'gemini-3-pro-image-preview' : 'google/gemini-2.0-flash-001',
            getModels: () => this.getImageModels()
        });

        // 图片优化区域
        containerEl.createEl('h3', { text: '图片优化' });

        new Setting(containerEl)
            .setName('Image Compression Quality')
            .setDesc('WebP 压缩质量 (0-100)，值越低文件越小但质量也越低，默认 80')
            .addSlider(slider => slider
                .setLimits(1, 100, 1)
                .setValue(this.plugin.settings.imageCompressionQuality)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.imageCompressionQuality = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Image Max Size')
            .setDesc('WebP 图片最大尺寸 (长边)，默认 2048')
            .addText(text => text
                .setPlaceholder('2048')
                .setValue(String(this.plugin.settings.imageMaxSize))
                .onChange(async (value) => {
                    const num = parseInt(value);
                    if (!isNaN(num) && num > 0) {
                        this.plugin.settings.imageMaxSize = num;
                        await this.plugin.saveSettings();
                    }
                }));

        // ========== Prompt Settings ==========
        containerEl.createEl('h3', { text: 'Prompt Settings' });

        new Setting(containerEl)
            .setName('Image System Prompt')
            .setDesc('图像生成时使用的系统提示词')
            .addTextArea(text => text
                .setPlaceholder('You are an expert creator...')
                .setValue(this.plugin.settings.imageSystemPrompt)
                .onChange(async (value) => {
                    this.plugin.settings.imageSystemPrompt = value;
                    await this.plugin.saveSettings();
                }));

        // Make the text area larger
        const textAreaEl = containerEl.querySelector('.setting-item:last-child textarea');
        if (textAreaEl) {
            (textAreaEl as HTMLTextAreaElement).rows = 3;
            (textAreaEl as HTMLTextAreaElement).style.width = '100%';
        }

        // ========== Developer Options ==========
        containerEl.createEl('h3', { text: 'Developer Options' });

        new Setting(containerEl)
            .setName('Debug Mode')
            .setDesc('开启后在面板中显示 Debug 按钮，用于输出调试信息')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.debugMode)
                .onChange(async (value) => {
                    this.plugin.settings.debugMode = value;
                    await this.plugin.saveSettings();
                }));

        // ========== About Section ==========
        containerEl.createEl('h3', { text: 'About' });
        containerEl.createEl('p', {
            text: 'Canvas AI 插件允许你在 Obsidian Canvas 中使用 AI 进行对话、文本生成和图像生成。'
        });
        containerEl.createEl('p', {
            cls: 'setting-item-description',
            text: '数据存储位置: .obsidian/plugins/obsidian-canvas-ai/data.json'
        });
    }

    /**
     * Helper to add test button
     */
    private addTestButton(parentEl: HTMLElement, resultContainer: HTMLElement) {
        const testBtn = parentEl.createEl('button', {
            text: '测试连接',
            cls: 'canvas-ai-test-btn'
        });

        const testResultEl = resultContainer.createDiv({ cls: 'canvas-ai-test-result' });
        testResultEl.style.display = 'none';

        testBtn.addEventListener('click', async () => {
            testBtn.textContent = '测试中...';
            testBtn.disabled = true;
            testResultEl.style.display = 'none';

            try {
                const apiManager = new ApiManager(this.plugin.settings);
                if (!apiManager.isConfigured()) {
                    throw new Error('请先填写 API Key');
                }
                const response = await apiManager.chatCompletion('Say "Connection successful!" in one line.');

                testBtn.textContent = '✓ 成功';
                testBtn.addClass('success');
                testResultEl.textContent = `✓ 连接成功: ${response.substring(0, 50)}...`;
                testResultEl.removeClass('error');
                testResultEl.addClass('success');
                testResultEl.style.display = 'block';

                setTimeout(() => {
                    testBtn.textContent = '测试连接';
                    testBtn.removeClass('success');
                }, 3000);
            } catch (error: any) {
                testBtn.textContent = '✗ 失败';
                testBtn.addClass('error');
                testResultEl.textContent = `✗ 连接失败: ${error.message}`;
                testResultEl.removeClass('success');
                testResultEl.addClass('error');
                testResultEl.style.display = 'block';

                setTimeout(() => {
                    testBtn.textContent = '测试连接';
                    testBtn.removeClass('error');
                }, 3000);
            } finally {
                testBtn.disabled = false;
            }
        });
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
    }): void {
        const { name, desc, modelKey, customKey, placeholder, getModels } = options;

        // Use type assertion to handle the specific setting types
        // This assumes modelKey is string property and customKey is boolean property
        const useCustom = this.plugin.settings[customKey] as boolean;
        const models = getModels();
        const hasModels = models.length > 0;

        const setting = new Setting(containerEl)
            .setName(name)
            .setDesc(desc);

        // Toggle for custom input mode
        setting.addToggle(toggle => toggle
            .setTooltip('手动输入模型名称')
            .setValue(useCustom || false) // Handle undefined
            .onChange(async (value) => {
                (this.plugin.settings[customKey] as boolean) = value;
                await this.plugin.saveSettings();
                // Re-render to switch between dropdown and text input
                this.display();
            }));

        if (useCustom || !hasModels) {
            // Text input mode (manual) or no models available
            setting.addText(text => text
                .setPlaceholder(placeholder)
                .setValue((this.plugin.settings[modelKey] as string) || '')
                .onChange(async (value) => {
                    (this.plugin.settings[modelKey] as string) = value;
                    await this.plugin.saveSettings();
                }));

            if (!hasModels && !useCustom) {
                setting.descEl.createEl('span', {
                    text: ' (无可用模型列表，请先刷新或手动输入)',
                    cls: 'canvas-ai-model-hint'
                });
            }
        } else {
            // Dropdown mode
            setting.addDropdown(dropdown => {
                const currentValue = (this.plugin.settings[modelKey] as string);

                // Add current value first if not in list (to preserve custom values)
                const modelIds = models.map(m => m.id);
                if (currentValue && !modelIds.includes(currentValue)) {
                    dropdown.addOption(currentValue, `${currentValue} (当前)`);
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
    }
}

