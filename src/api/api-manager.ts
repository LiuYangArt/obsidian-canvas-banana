/**
 * API Manager - 统一入口
 * 路由到对应的 Provider 处理 API 请求
 */

import type { CanvasAISettings } from '../settings/settings';
import { OpenRouterProvider } from './providers/openrouter';
import { GeminiProvider } from './providers/gemini';
import { GptGodProvider } from './providers/gptgod';

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
import type { GeminiContent } from './types';

export class ApiManager {
    private settings: CanvasAISettings;
    private openrouter: OpenRouterProvider;
    private gemini: GeminiProvider;
    private yunwu: GeminiProvider;
    private gptgod: GptGodProvider;

    constructor(settings: CanvasAISettings) {
        this.settings = settings;
        this.openrouter = new OpenRouterProvider(settings);
        this.gemini = new GeminiProvider(settings, false);
        this.yunwu = new GeminiProvider(settings, true);
        this.gptgod = new GptGodProvider(settings);
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
    }

    /**
     * Get the current active provider
     */
    private getActiveProvider(): 'openrouter' | 'yunwu' | 'gemini' | 'gptgod' {
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
            default:
                return this.openrouter.chatCompletion(prompt, systemPrompt, temperature);
        }
    }

    /**
     * Send a stream chat completion request
     */
    async *streamChatCompletion(
        prompt: string | GeminiContent[],
        systemPrompt?: string,
        temperature: number = 1.0,
        thinkingConfig?: { enabled: boolean; budgetTokens?: number; level?: 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH' }
    ): AsyncGenerator<{ content?: string; thinking?: string; thoughtSignature?: string }, void, unknown> {
        if (!this.isConfigured()) {
            throw new Error('API Key not configured. Please set it in plugin settings.');
        }

        const provider = this.getActiveProvider();
        


        // Convert to string for providers that don't support native history object
        const textPrompt = this.convertContentToString(prompt);

        if (provider === 'openrouter') { 
             yield* this.openrouter.streamChatCompletion(textPrompt, systemPrompt, temperature);
             return;
        }

        if (provider === 'gemini') {
             // Gemini provider updated to take GeminiContent[]
             yield* this.gemini.streamChatCompletion(prompt, systemPrompt, temperature, thinkingConfig);
             return;
        }

        if (provider === 'yunwu') {
             // Yunwu (GeminiProvider) updated to take GeminiContent[]
             yield* this.yunwu.streamChatCompletion(prompt, systemPrompt, temperature, thinkingConfig);
             return;
        }

        if (provider === 'gptgod') {
             yield* this.gptgod.streamChatCompletion(textPrompt, systemPrompt, temperature);
             return;
        }

        // Fallback for others: wait for full response and yield it
        const fullResponse = await this.chatCompletion(textPrompt, systemPrompt, temperature);
        yield { content: fullResponse };
    }

    private convertContentToString(content: string | GeminiContent[]): string {
        if (typeof content === 'string') return content;
        
        // Convert history array to string format
        // User: ...
        // Model: ...
        return content.map(item => {
            const role = item.role === 'user' ? 'User' : 'Model';
            const text = item.parts.map(p => p.text || '').join('');
            return `${role}: ${text}`;
        }).join('\n\n');
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
            default:
                return this.openrouter.generateImage(instruction, imagesWithRoles, contextText, aspectRatio, resolution);
        }
    }

    /**
     * Send multimodal chat request with images and/or PDFs
     * Returns content and optional thinking
     */
    async multimodalChat(
        prompt: string,
        mediaList: { base64: string, mimeType: string, type: 'image' | 'pdf' }[],
        systemPrompt?: string,
        temperature: number = 1.0,
        thinkingConfig?: { enabled: boolean; budgetTokens?: number; level?: 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH' }
    ): Promise<{ content: string; thinking?: string }> {
        if (!this.isConfigured()) {
            throw new Error('API Key not configured. Please set it in plugin settings.');
        }

        const provider = this.getActiveProvider();
        switch (provider) {
            case 'gemini':
                return this.gemini.multimodalChat(prompt, mediaList, systemPrompt, temperature, thinkingConfig);
            case 'yunwu':
                return this.yunwu.multimodalChat(prompt, mediaList, systemPrompt, temperature, thinkingConfig);
            case 'gptgod':
                return this.gptgod.multimodalChat(prompt, mediaList, systemPrompt, temperature);
            default:
                return this.openrouter.multimodalChat(prompt, mediaList, systemPrompt, temperature);
        }
    }
}
