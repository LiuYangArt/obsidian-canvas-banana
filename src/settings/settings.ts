/**
 * Canvas AI Plugin Settings
 * 设置接口、类型和默认值
 */

import { DEFAULT_EDIT_MODE_PROMPT } from '../prompts';

// ========== API Provider Type ==========
export type ApiProvider = 'openrouter' | 'yunwu' | 'gemini' | 'gptgod';

// ========== Quick Switch Model ==========
export interface QuickSwitchModel {
    provider: ApiProvider;
    modelId: string;
    displayName: string;
}

// ========== Prompt Preset ==========
export interface PromptPreset {
    id: string;      // UUID
    name: string;    // Display name
    prompt: string;  // Prompt content
}

// ========== Plugin Settings Interface ==========
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
    geminiBaseUrl: string;
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

    // Image compression settings
    imageCompressionQuality: number;  // WebP compression quality (0-100)
    imageMaxSize: number;  // Max width/height for WebP output

    // Image generation defaults (palette state)
    defaultAspectRatio: string;
    defaultResolution: string;
    defaultChatTemperature: number;

    // Debug mode
    debugMode: boolean;

    // Double-click image to open in new window
    doubleClickImageOpen: boolean;
    // Reuse single window for images
    singleWindowMode: boolean;

    // System prompts for different modes
    textSystemPrompt: string;
    editSystemPrompt: string;
    nodeSystemPrompt: string;
    imageSystemPrompt: string;

    // Node mode settings
    nodeDefaultColor: string;  // Override color for generated nodes ("1"-"6" or empty)

    // Prompt presets - separate for chat, image, node, and edit modes
    chatPresets: PromptPreset[];
    imagePresets: PromptPreset[];
    nodePresets: PromptPreset[];
    editPresets: PromptPreset[];

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
    paletteEditModel: string;

    // Notes AI settings
    enableGlobalConsistency: boolean;  // 全局实体一致性检测
    maxConversationTurns: number;      // 侧边栏最大对话轮数
}

// ========== Default Settings ==========
export const DEFAULT_SETTINGS: CanvasAISettings = {
    apiProvider: 'openrouter',

    openRouterApiKey: '',
    openRouterBaseUrl: 'https://openrouter.ai',
    openRouterTextModel: 'google/gemini-2.5-flash',
    openRouterImageModel: 'google/gemini-3-pro-image-preview',
    openRouterUseCustomTextModel: false,
    openRouterUseCustomImageModel: false,

    yunwuApiKey: '',
    yunwuBaseUrl: 'https://yunwu.ai',
    yunwuTextModel: 'gemini-2.5-flash',
    yunwuImageModel: 'gemini-3-pro-image-preview',
    yunwuUseCustomTextModel: false,
    yunwuUseCustomImageModel: false,

    geminiApiKey: '',
    geminiBaseUrl: 'https://generativelanguage.googleapis.com',
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

    imageCompressionQuality: 80,
    imageMaxSize: 2048,
    defaultAspectRatio: '1:1',
    defaultResolution: '1K',
    defaultChatTemperature: 0.5,

    debugMode: false,
    doubleClickImageOpen: true,
    singleWindowMode: true,

    textSystemPrompt: 'You are a helpful AI assistant embedded in an Obsidian Canvas. Answer concisely and use Markdown formatting.',
    editSystemPrompt: DEFAULT_EDIT_MODE_PROMPT,
    nodeSystemPrompt: '',
    imageSystemPrompt: 'Role: A Professional Image Creator. Use the following references for image creation.',

    nodeDefaultColor: '6',

    chatPresets: [],
    imagePresets: [],
    nodePresets: [],
    editPresets: [],
    defaultNodeTemperature: 0.5,

    imageGenerationTimeout: 120,

    quickSwitchTextModels: [],
    quickSwitchImageModels: [],
    paletteTextModel: '',
    paletteImageModel: '',
    paletteNodeModel: '',
    paletteEditModel: '',

    enableGlobalConsistency: true,
    maxConversationTurns: 5
};

// ========== Provider Utility Functions ==========

/**
 * Get model ID by provider and type
 */
export function getModelByProvider(
    settings: CanvasAISettings,
    provider: ApiProvider,
    type: 'text' | 'image'
): string {
    const key = type === 'text' ? 'TextModel' : 'ImageModel';
    switch (provider) {
        case 'openrouter':
            return settings[`openRouter${key}`];
        case 'yunwu':
            return settings[`yunwu${key}`];
        case 'gemini':
            return settings[`gemini${key}`];
        case 'gptgod':
            return settings[`gptGod${key}`];
        default:
            return '';
    }
}

/**
 * Set model ID by provider and type
 */
export function setModelByProvider(
    settings: CanvasAISettings,
    provider: ApiProvider,
    type: 'text' | 'image',
    modelId: string
): void {
    switch (provider) {
        case 'openrouter':
            if (type === 'text') settings.openRouterTextModel = modelId;
            else settings.openRouterImageModel = modelId;
            break;
        case 'yunwu':
            if (type === 'text') settings.yunwuTextModel = modelId;
            else settings.yunwuImageModel = modelId;
            break;
        case 'gemini':
            if (type === 'text') settings.geminiTextModel = modelId;
            else settings.geminiImageModel = modelId;
            break;
        case 'gptgod':
            if (type === 'text') settings.gptGodTextModel = modelId;
            else settings.gptGodImageModel = modelId;
            break;
    }
}
