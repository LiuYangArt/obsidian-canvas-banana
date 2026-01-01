/**
 * API Manager - 统一入口
 * 路由到对应的 Provider 处理 API 请求
 */

import type { CanvasAISettings } from '../settings/settings';
import { OpenRouterProvider } from './providers/openrouter';
import { GeminiProvider } from './providers/gemini';
import { GptGodProvider } from './providers/gptgod';
import { AntigravityToolsProvider } from './providers/antigravitytools';

// Re-export types for backward compatibility
export type {
    OpenRouterMessage,
    OpenRouterContentPart,
    OpenRouterImageConfig,
    OpenRouterRequest,
    OpenRouterChoice,
    OpenRouterResponse,
    GptGodResponse,
    GeminiPart,
    GeminiContent,
    GeminiRequest,
    GeminiCandidate,
    GeminiResponse
} from './types';

export class ApiManager {
    private settings: CanvasAISettings;
    private openrouter: OpenRouterProvider;
    private gemini: GeminiProvider;
    private yunwu: GeminiProvider;
    private gptgod: GptGodProvider;
    private antigravitytools: AntigravityToolsProvider;

    constructor(settings: CanvasAISettings) {
        this.settings = settings;
        this.openrouter = new OpenRouterProvider(settings);
        this.gemini = new GeminiProvider(settings, false);
        this.yunwu = new GeminiProvider(settings, true);
        this.gptgod = new GptGodProvider(settings);
        this.antigravitytools = new AntigravityToolsProvider(settings);
    }

    /**
     * Update settings reference (called when settings change)
     */
    updateSettings(settings: CanvasAISettings): void {
        this.settings = settings;
        this.openrouter.updateSettings(settings);
        this.gemini.updateSettings(settings);
        this.yunwu.updateSettings(settings);
        this.gptgod.updateSettings(settings);
        this.antigravitytools.updateSettings(settings);
    }

    /**
     * Get the current active provider
     */
    private getActiveProvider(): 'openrouter' | 'yunwu' | 'gemini' | 'gptgod' | 'antigravitytools' {
        return this.settings.apiProvider || 'openrouter';
    }

    /**
     * Get the API key to use based on active provider
     */
    private getApiKey(): string {
        const provider = this.getActiveProvider();
        switch (provider) {
            case 'gemini':
                return this.gemini.getApiKey();
            case 'yunwu':
                return this.yunwu.getApiKey();
            case 'gptgod':
                return this.gptgod.getApiKey();
            case 'antigravitytools':
                return this.antigravitytools.getApiKey();
            default:
                return this.openrouter.getApiKey();
        }
    }

    /**
     * Check if API is configured
     */
    isConfigured(): boolean {
        return !!this.getApiKey();
    }

    /**
     * Send a chat completion request
     */
    async chatCompletion(prompt: string, systemPrompt?: string, temperature: number = 0.5): Promise<string> {
        if (!this.isConfigured()) {
            throw new Error('API Key not configured. Please set it in plugin settings.');
        }

        const provider = this.getActiveProvider();
        switch (provider) {
            case 'gemini':
                return this.gemini.chatCompletion(prompt, systemPrompt, temperature);
            case 'yunwu':
                return this.yunwu.chatCompletion(prompt, systemPrompt, temperature);
            case 'gptgod':
                return this.gptgod.chatCompletion(prompt, systemPrompt, temperature);
            case 'antigravitytools':
                return this.antigravitytools.chatCompletion(prompt, systemPrompt, temperature);
            default:
                return this.openrouter.chatCompletion(prompt, systemPrompt, temperature);
        }
    }

    /**
     * Generate an image with role-annotated references
     */
    async generateImageWithRoles(
        instruction: string,
        imagesWithRoles: { base64: string, mimeType: string, role: string }[],
        contextText?: string,
        aspectRatio?: string,
        resolution?: string
    ): Promise<string> {
        if (!this.isConfigured()) {
            throw new Error('API Key not configured. Please set it in plugin settings.');
        }

        const provider = this.getActiveProvider();
        switch (provider) {
            case 'gemini':
                return this.gemini.generateImage(instruction, imagesWithRoles, contextText, aspectRatio, resolution);
            case 'yunwu':
                return this.yunwu.generateImage(instruction, imagesWithRoles, contextText, aspectRatio, resolution);
            case 'gptgod':
                return this.gptgod.generateImage(instruction, imagesWithRoles, contextText, aspectRatio, resolution);
            case 'antigravitytools':
                return this.antigravitytools.generateImage(instruction, imagesWithRoles, contextText, aspectRatio, resolution);
            default:
                return this.openrouter.generateImage(instruction, imagesWithRoles, contextText, aspectRatio, resolution);
        }
    }

    /**
     * Send multimodal chat request with images and/or PDFs
     */
    async multimodalChat(
        prompt: string,
        mediaList: { base64: string, mimeType: string, type: 'image' | 'pdf' }[],
        systemPrompt?: string,
        temperature: number = 0.5
    ): Promise<string> {
        if (!this.isConfigured()) {
            throw new Error('API Key not configured. Please set it in plugin settings.');
        }

        const provider = this.getActiveProvider();
        switch (provider) {
            case 'gemini':
                return this.gemini.multimodalChat(prompt, mediaList, systemPrompt, temperature);
            case 'yunwu':
                return this.yunwu.multimodalChat(prompt, mediaList, systemPrompt, temperature);
            case 'gptgod':
                return this.gptgod.multimodalChat(prompt, mediaList, systemPrompt, temperature);
            case 'antigravitytools':
                return this.antigravitytools.multimodalChat(prompt, mediaList, systemPrompt, temperature);
            default:
                return this.openrouter.multimodalChat(prompt, mediaList, systemPrompt, temperature);
        }
    }
}
