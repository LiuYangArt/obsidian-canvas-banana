/**
 * API Manager for OpenRouter/Gemini API integration
 * Handles communication with LLM services
 */

import { requestUrl, RequestUrlParam } from 'obsidian';
import type { CanvasAISettings } from './main';

// ========== Types ==========

export interface OpenRouterMessage {
    role: 'user' | 'assistant' | 'system';
    content: string | OpenRouterContentPart[];
    reasoning_details?: any;
}

export interface OpenRouterContentPart {
    type: 'text' | 'image_url';
    text?: string;
    image_url?: {
        url: string; // Can be URL or data:image/...;base64,...
    };
}

export interface OpenRouterImageConfig {
    aspect_ratio?: '1:1' | '16:9' | '4:3' | '9:16';
    image_size?: string;
}

export interface OpenRouterRequest {
    model: string;
    messages: OpenRouterMessage[];
    modalities?: ('text' | 'image')[];
    image_config?: OpenRouterImageConfig;
    reasoning?: { enabled: boolean };
}

export interface OpenRouterChoice {
    message: {
        role: string;
        content: string;
        images?: Array<{
            image_url: {
                url: string; // Base64 data URL
            };
        }>;
        reasoning_details?: any;
    };
    finish_reason: string;
}

export interface OpenRouterResponse {
    id: string;
    model: string;
    choices: OpenRouterChoice[];
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
    error?: {
        message: string;
        type: string;
        code: string;
    };
}

// ========== API Manager Class ==========

export class ApiManager {
    private settings: CanvasAISettings;

    constructor(settings: CanvasAISettings) {
        this.settings = settings;
    }

    /**
     * Update settings reference (called when settings change)
     */
    updateSettings(settings: CanvasAISettings): void {
        this.settings = settings;
    }

    /**
     * Get the API key to use
     */
    private getApiKey(): string {
        return this.settings.openRouterApiKey || '';
    }

    /**
     * Get the base URL (from settings or default)
     */
    private getBaseUrl(): string {
        return this.settings.openRouterBaseUrl || 'https://openrouter.ai/api/v1/chat/completions';
    }

    /**
     * Get text generation model
     */
    private getTextModel(): string {
        return this.settings.textModel || 'google/gemini-2.5-flash-preview';
    }

    /**
     * Get image generation model
     */
    private getImageModel(): string {
        return this.settings.imageModel || 'google/gemini-2.5-flash-image-preview';
    }

    /**
     * Check if API is configured
     */
    isConfigured(): boolean {
        return !!this.getApiKey();
    }

    /**
     * Send a chat completion request to OpenRouter
     * @param prompt User's prompt text
     * @param systemPrompt Optional system prompt
     * @returns The assistant's response text
     */
    async chatCompletion(prompt: string, systemPrompt?: string): Promise<string> {
        if (!this.isConfigured()) {
            throw new Error('OpenRouter API Key not configured. Please set it in plugin settings.');
        }

        const messages: OpenRouterMessage[] = [];

        if (systemPrompt) {
            messages.push({
                role: 'system',
                content: systemPrompt
            });
        }

        messages.push({
            role: 'user',
            content: prompt
        });

        const requestBody: OpenRouterRequest = {
            model: this.getTextModel(),
            messages: messages
        };

        console.log('Canvas AI: Sending chat request to OpenRouter...');
        console.log('Request body:', JSON.stringify(requestBody, null, 2));

        const response = await this.sendRequest(requestBody);

        if (response.error) {
            throw new Error(`OpenRouter API Error: ${response.error.message}`);
        }

        if (!response.choices || response.choices.length === 0) {
            throw new Error('OpenRouter returned no choices');
        }

        const content = response.choices[0].message.content;
        console.log('Canvas AI: Received response:', content);

        return content;
    }

    /**
     * Generate an image using OpenRouter's multimodal API
     * @param prompt Description of the image to generate
     * @param aspectRatio Optional aspect ratio (1:1, 16:9, 4:3, 9:16)
     * @param imageSize Optional image size (e.g. 1024x1024)
     * @returns Base64 data URL of the generated image
     */
    async generateImage(prompt: string, aspectRatio?: '1:1' | '16:9' | '4:3' | '9:16', imageSize?: string, inputImages?: { base64: string, mimeType: string }[]): Promise<string> {
        if (!this.isConfigured()) {
            throw new Error('OpenRouter API Key not configured. Please set it in plugin settings.');
        }

        const messages: OpenRouterMessage[] = [];
        const contentParts: OpenRouterContentPart[] = [];

        // Add images first (based on working example)
        if (inputImages && inputImages.length > 0) {
            for (const img of inputImages) {
                const mime = img.mimeType || 'image/png';
                const url = `data:${mime};base64,${img.base64}`;
                console.log(`Canvas AI: Adding input image, mimeType: ${mime}, base64 length: ${img.base64.length}, url prefix: ${url.substring(0, 50)}`);
                contentParts.push({
                    type: 'image_url',
                    image_url: {
                        url: url
                    }
                });
            }
        }

        // Add text prompt
        contentParts.push({
            type: 'text',
            text: prompt
        });

        messages.push({
            role: 'user',
            content: contentParts
        });

        const requestBody: OpenRouterRequest = {
            model: this.getImageModel(),
            messages: messages,
            modalities: ['image', 'text']
        };

        if (aspectRatio || imageSize) {
            requestBody.image_config = {};
            if (aspectRatio) {
                requestBody.image_config.aspect_ratio = aspectRatio;
            }
            if (imageSize) {
                requestBody.image_config.image_size = imageSize;
            }
        }

        console.log('Canvas AI: Sending image generation request to OpenRouter...');
        console.log('Request body:', JSON.stringify(requestBody, null, 2));

        const response = await this.sendRequest(requestBody);

        if (response.error) {
            throw new Error(`OpenRouter API Error: ${response.error.message}`);
        }

        if (!response.choices || response.choices.length === 0) {
            throw new Error('OpenRouter returned no choices');
        }

        const message = response.choices[0].message;

        // Check for images in response
        if (message.images && message.images.length > 0) {
            const imageUrl = message.images[0].image_url.url;
            console.log('Canvas AI: Received image, length:', imageUrl.length);
            return imageUrl;
        }

        // If no image, return the text content (model may have declined to generate)
        console.log('Canvas AI: No image in response, content:', message.content);
        throw new Error(`Image generation failed: ${message.content || 'No image returned'}`);
    }

    /**
     * Send multimodal chat request with images
     * @param prompt User's prompt text
     * @param imageList Array of { base64, mimeType }
     * @param systemPrompt Optional system prompt
     * @returns The assistant's response text
     */
    async multimodalChat(
        prompt: string,
        imageList: { base64: string, mimeType: string }[],
        systemPrompt?: string
    ): Promise<string> {
        if (!this.isConfigured()) {
            throw new Error('OpenRouter API Key not configured. Please set it in plugin settings.');
        }

        const messages: OpenRouterMessage[] = [];

        if (systemPrompt) {
            messages.push({
                role: 'system',
                content: systemPrompt
            });
        }

        // Build multimodal content
        const contentParts: OpenRouterContentPart[] = [
            {
                type: 'text',
                text: prompt
            }
        ];

        // Add images
        for (const img of imageList) {
            const mime = img.mimeType || 'image/png';
            const url = `data:${mime};base64,${img.base64}`;

            contentParts.push({
                type: 'image_url',
                image_url: {
                    url: url
                }
            });
        }

        messages.push({
            role: 'user',
            content: contentParts
        });

        const requestBody: OpenRouterRequest = {
            model: this.getTextModel(),
            messages: messages
        };

        console.log('Canvas AI: Sending multimodal chat request to OpenRouter...');

        const response = await this.sendRequest(requestBody);

        if (response.error) {
            throw new Error(`OpenRouter API Error: ${response.error.message}`);
        }

        if (!response.choices || response.choices.length === 0) {
            throw new Error('OpenRouter returned no choices');
        }

        return response.choices[0].message.content;
    }

    /**
     * Internal method to send request to OpenRouter
     */
    private async sendRequest(body: OpenRouterRequest): Promise<OpenRouterResponse> {
        const apiKey = this.getApiKey();

        const requestParams: RequestUrlParam = {
            url: this.getBaseUrl(),
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://obsidian.md',
                'X-Title': 'Obsidian Canvas AI'
            },
            body: JSON.stringify(body)
        };

        try {
            const response = await requestUrl(requestParams);
            return response.json as OpenRouterResponse;
        } catch (error: any) {
            // Handle HTTP errors
            if (error.status) {
                const errorBody = error.json || { message: error.message };
                console.error('Canvas AI: HTTP Error', error.status, errorBody);
                throw new Error(`HTTP ${error.status}: ${errorBody.error?.message || error.message}`);
            }
            throw error;
        }
    }
}
