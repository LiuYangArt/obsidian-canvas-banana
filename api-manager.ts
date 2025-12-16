/**
 * API Manager for OpenRouter/Gemini API integration
 * Handles communication with LLM services
 */

import { requestUrl, RequestUrlParam, RequestUrlResponse } from 'obsidian';
import type { CanvasAISettings } from './main';

// ========== Error Type Helpers ==========

/**
 * Type guard for HTTP errors from requestUrl
 */
interface HttpError {
    status: number;
    message: string;
    json?: Record<string, unknown>;
}

function isHttpError(error: unknown): error is HttpError {
    return typeof error === 'object' && error !== null && 'status' in error && typeof (error as HttpError).status === 'number';
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    return String(error);
}

// ========== Timeout Helper ==========

/**
 * Wraps requestUrl with a timeout mechanism using Promise.race
 * @param params Request parameters
 * @param timeoutMs Timeout in milliseconds
 * @returns Promise that rejects with timeout error if request takes too long
 */
async function requestUrlWithTimeout(params: RequestUrlParam, timeoutMs: number): Promise<RequestUrlResponse> {
    const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
            reject(new Error(`TIMEOUT:${timeoutMs}`));
        }, timeoutMs);
    });

    return Promise.race([requestUrl(params), timeoutPromise]);
}

// ========== Types ==========

export interface OpenRouterMessage {
    role: 'user' | 'assistant' | 'system';
    content: string | OpenRouterContentPart[];
    reasoning_details?: Record<string, unknown>;
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
    temperature?: number;
    tools?: Array<{ google_search?: Record<string, never> }>;
}

export interface OpenRouterChoice {
    message: {
        role: string;
        content: string | OpenRouterContentPart[]; // Allow array content
        images?: Array<{
            image_url: {
                url: string;
            };
        }> | string[]; // Allow string array for GPTGod
        image_url?: string; // GPTGod field
        reasoning_details?: Record<string, unknown>;
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

export type GptGodResponse = OpenRouterResponse & {
    images?: string[];
    image?: string;
    data?: Record<string, unknown>; // Allow flexible data field for GPTGod
};

export interface GeminiPart {
    text?: string;
    inlineData?: {
        mimeType: string;
        data: string;
    };
    file_data?: {
        file_uri: string;
        mime_type: string;
    };
    thought?: boolean;
}

export interface GeminiContent {
    role: 'user' | 'model';
    parts: GeminiPart[];
}

export interface GeminiRequest {
    contents: GeminiContent[];
    generationConfig?: {
        temperature?: number;
        responseModalities?: ('image' | 'text')[];
        imageConfig?: {
            aspectRatio?: string;
            imageSize?: string;
        };
    };
    systemInstruction?: {
        parts: GeminiPart[];
    };
}

export interface GeminiCandidate {
    content?: {
        parts?: GeminiPart[];
    };
    formish_reason?: string;
}

export interface GeminiResponse {
    candidates?: GeminiCandidate[];
    error?: {
        message: string;
        code: number;
    }
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
        if (provider === 'gemini') {
            return this.settings.geminiApiKey || '';
        }
        if (provider === 'yunwu') {
            return this.settings.yunwuApiKey || '';
        }
        if (provider === 'gptgod') {
            return this.settings.gptGodApiKey || '';
        }
        return this.settings.openRouterApiKey || '';
    }

    /**
     * Get the chat endpoint URL based on active provider
     * Both OpenRouter and Yunwu use OpenAI-compatible format for chat
     */
    private getChatEndpoint(): string {
        if (this.getActiveProvider() === 'yunwu') {
            const base = this.settings.yunwuBaseUrl || 'https://yunwu.ai';
            return `${base}/v1/chat/completions`;
        }
        if (this.getActiveProvider() === 'gptgod') {
            const base = this.settings.gptGodBaseUrl || 'https://api.gptgod.online';
            return `${base}/v1/chat/completions`;
        }
        return this.settings.openRouterBaseUrl || 'https://openrouter.ai/api/v1/chat/completions';
    }

    /**
     * Get text generation model based on active provider
     */
    private getTextModel(): string {
        const provider = this.getActiveProvider();
        if (provider === 'gemini') {
            return this.settings.geminiTextModel || 'gemini-2.5-flash';
        }
        if (provider === 'yunwu') {
            return this.settings.yunwuTextModel || 'gemini-2.0-flash';
        }
        if (provider === 'gptgod') {
            return this.settings.gptGodTextModel || 'gpt-4-gizmo-g-2fkFE8rbu';
        }
        return this.settings.openRouterTextModel || 'google/gemini-2.0-flash-001';
    }

    /**
     * Get image generation model based on active provider
     */
    private getImageModel(): string {
        const provider = this.getActiveProvider();
        if (provider === 'gemini') {
            return this.settings.geminiImageModel || 'gemini-2.5-flash-preview-05-20';
        }
        if (provider === 'yunwu') {
            return this.settings.yunwuImageModel || 'gemini-3-pro-image-preview';
        }
        if (provider === 'gptgod') {
            return this.settings.gptGodImageModel || 'gemini-3-pro-image-preview';
        }
        return this.settings.openRouterImageModel || 'google/gemini-2.0-flash-001';
    }

    /**
     * Check if API is configured
     */
    isConfigured(): boolean {
        return !!this.getApiKey();
    }

    /**
     * Send a chat completion request
     * @param prompt User's prompt text
     * @param systemPrompt Optional system prompt
     * @returns The assistant's response text
     */
    async chatCompletion(prompt: string, systemPrompt?: string, temperature: number = 0.5): Promise<string> {
        if (!this.isConfigured()) {
            throw new Error('API Key not configured. Please set it in plugin settings.');
        }

        const provider = this.getActiveProvider();

        // Route Gemini and Yunwu to native Gemini API format
        if (provider === 'gemini' || provider === 'yunwu') {
            return this.chatCompletionGeminiNative(prompt, systemPrompt, temperature);
        }

        // OpenRouter and GPTGod use OpenAI-compatible format
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
            messages: messages,
            temperature: temperature
        };

        const providerName = provider === 'gptgod' ? 'GPTGod' : 'OpenRouter';
        console.debug(`Canvas AI: Sending chat request to ${providerName}...`);
        console.debug('Request body:', JSON.stringify(requestBody, null, 2));

        const response = await this.sendRequest(requestBody);

        if (response.error) {
            throw new Error(`${providerName} API Error: ${response.error.message}`);
        }

        if (!response.choices || response.choices.length === 0) {
            throw new Error(`${providerName} returned no choices`);
        }

        const content = response.choices[0].message.content;
        console.debug('Canvas AI: Received response:', typeof content === 'string' ? content : 'multimodal content');

        return typeof content === 'string' ? content : content.map(p => p.text || '').join('');
    }

    /**
     * Chat completion using Gemini native API format
     * Shared by Gemini and Yunwu providers
     */
    private async chatCompletionGeminiNative(prompt: string, systemPrompt?: string, temperature: number = 0.5): Promise<string> {
        const provider = this.getActiveProvider();
        const apiKey = this.getApiKey();
        const model = this.getTextModel();

        // Build base URL
        let baseUrl: string;
        if (provider === 'gemini') {
            baseUrl = 'https://generativelanguage.googleapis.com';
        } else {
            baseUrl = this.settings.yunwuBaseUrl || 'https://yunwu.ai';
        }

        const endpoint = `${baseUrl}/v1beta/models/${model}:generateContent?key=${apiKey}`;

        // Build request body in Gemini native format
        const parts: Array<{ text: string }> = [];
        if (systemPrompt) {
            parts.push({ text: systemPrompt });
        }
        parts.push({ text: prompt });

        const requestBody: GeminiRequest = {
            contents: [{
                role: 'user',
                parts: parts
            }],
            generationConfig: {
                temperature: temperature
            }
        };

        // Add system instruction if provided (Gemini's separate field)
        if (systemPrompt) {
            requestBody.systemInstruction = {
                parts: [{ text: systemPrompt }]
            };
            // Remove from user content since it's in systemInstruction
            requestBody.contents[0].parts = [{ text: prompt }];
        }

        console.debug(`Canvas AI: [${provider}] Sending chat request...`);

        const requestParams: RequestUrlParam = {
            url: endpoint,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        };

        try {
            const response = await requestUrl(requestParams);
            const data = response.json as GeminiResponse;

            // Parse Gemini response format
            const candidates = data.candidates;
            if (!candidates || candidates.length === 0) {
                throw new Error('Gemini returned no candidates');
            }

            const parts = candidates[0]?.content?.parts;
            if (!parts || parts.length === 0) {
                throw new Error('Gemini returned no parts in response');
            }

            // Find text part (filter out thinking parts for thinking models)
            // Thinking models return parts with { thought: true } for internal reasoning
            const outputParts = parts.filter((p: GeminiPart) => p.text && !p.thought);
            const textPart = outputParts.length > 0 ? outputParts[outputParts.length - 1] : parts.find((p: GeminiPart) => p.text);
            if (!textPart?.text) {
                throw new Error('Gemini returned no text in response');
            }

            console.debug(`Canvas AI: [${provider}] Received response (filtered thinking):`, textPart.text.substring(0, 100));
            return textPart.text;
        } catch (error: unknown) {
            if (isHttpError(error)) {
                const errorBody = error.json || { message: error.message };
                const errorMessage = (errorBody as Record<string, Record<string, string>>).error?.message || error.message;
                console.error(`Canvas AI: ${provider} HTTP Error`, error.status, errorBody);
                throw new Error(`HTTP ${error.status}: ${errorMessage}`);
            }
            throw error;
        }
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
                console.debug(`Canvas AI: Adding input image, mimeType: ${mime}, base64 length: ${img.base64.length}, url prefix: ${url.substring(0, 50)}`);
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

        console.debug('Canvas AI: Sending image generation request to OpenRouter...');
        console.debug('Request body:', JSON.stringify(requestBody, null, 2));

        // Use timeout for image generation
        const timeoutMs = (this.settings.imageGenerationTimeout || 120) * 1000;
        const response = await this.sendRequest(requestBody, timeoutMs);

        if (response.error) {
            throw new Error(`OpenRouter API Error: ${response.error.message}`);
        }

        if (!response.choices || response.choices.length === 0) {
            throw new Error('OpenRouter returned no choices');
        }

        const message = response.choices[0].message;

        // Check for images in response
        if (message.images && message.images.length > 0) {
            const firstImage = message.images[0];
            const imageUrl = typeof firstImage === 'string' ? firstImage : firstImage.image_url.url;
            console.debug('Canvas AI: Received image, length:', imageUrl.length);
            return imageUrl;
        }

        // If no image, return the text content (model may have declined to generate)
        const textContent = typeof message.content === 'string'
            ? message.content
            : Array.isArray(message.content)
                ? message.content.map(p => p.text || '').join('')
                : 'No image returned';
        console.debug('Canvas AI: No image in response, content:', textContent);
        throw new Error(`Image generation failed: ${textContent || 'No image returned'}`);
    }

    /**
     * Generate an image with role-annotated references
     * Follows design_doc_v2.md Section 4 payload format
     * @param instruction The main instruction/prompt
     * @param imagesWithRoles Array of images with their semantic roles
     * @param contextText Additional context text
     * @param aspectRatio Optional aspect ratio (supports extended ratios)
     * @param resolution Optional resolution (1K, 2K, 4K)
     * @returns Base64 data URL of the generated image
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

        // Route to provider-specific implementation
        const provider = this.getActiveProvider();
        if (provider === 'gemini' || provider === 'yunwu') {
            return this.generateImageGeminiNative(instruction, imagesWithRoles, contextText, aspectRatio, resolution);
        }
        if (provider === 'gptgod') {
            return this.generateImageGptGod(instruction, imagesWithRoles, contextText, aspectRatio, resolution);
        }
        return this.generateImageOpenRouter(instruction, imagesWithRoles, contextText, aspectRatio, resolution);
    }

    /**
     * Generate image using OpenRouter format (OpenAI-compatible with image_config)
     */
    private async generateImageOpenRouter(
        instruction: string,
        imagesWithRoles: { base64: string, mimeType: string, role: string }[],
        contextText?: string,
        aspectRatio?: string,
        resolution?: string
    ): Promise<string> {
        const contentParts: OpenRouterContentPart[] = [];

        // System context from settings
        contentParts.push({
            type: 'text',
            text: this.settings.imageSystemPrompt || 'You are an expert creator. Use the following references.'
        });

        // Add images with role annotations
        for (const img of imagesWithRoles) {
            const mime = img.mimeType || 'image/png';
            const url = `data:${mime};base64,${img.base64}`;

            // Add role label before image
            contentParts.push({
                type: 'text',
                text: `\n[Ref: ${img.role}]`
            });

            contentParts.push({
                type: 'image_url',
                image_url: { url }
            });
        }

        // Add context text if present
        if (contextText && contextText.trim()) {
            contentParts.push({
                type: 'text',
                text: `\n[Context]\n${contextText}`
            });
        }

        // Add instruction
        contentParts.push({
            type: 'text',
            text: `\nINSTRUCTION: ${instruction}`
        });

        const messages: OpenRouterMessage[] = [{
            role: 'user',
            content: contentParts
        }];

        const requestBody: OpenRouterRequest = {
            model: this.getImageModel(),
            messages,
            modalities: ['image']  // Only request image output to ensure generation
        };

        if (aspectRatio || resolution) {
            requestBody.image_config = {};
            if (aspectRatio) {
                requestBody.image_config.aspect_ratio = aspectRatio as '1:1' | '16:9' | '4:3' | '9:16';
            }
            if (resolution) {
                requestBody.image_config.image_size = resolution;
            }
        }

        console.debug('Canvas AI: [OpenRouter] Sending image generation request...');
        console.debug('Request body:', JSON.stringify(requestBody, null, 2));

        // Use timeout for image generation
        const timeoutMs = (this.settings.imageGenerationTimeout || 120) * 1000;
        const response = await this.sendRequest(requestBody, timeoutMs);

        if (response.error) {
            throw new Error(`OpenRouter API Error: ${response.error.message}`);
        }

        if (!response.choices || response.choices.length === 0) {
            throw new Error('OpenRouter returned no choices');
        }

        const message = response.choices[0].message;

        if (message.images && message.images.length > 0) {
            const firstImage = message.images[0];
            const imageUrl = typeof firstImage === 'string' ? firstImage : firstImage.image_url.url;
            console.debug('Canvas AI: Received image, length:', imageUrl.length);
            return imageUrl;
        }

        const textContent = typeof message.content === 'string'
            ? message.content
            : Array.isArray(message.content)
                ? message.content.map(p => p.text || '').join('')
                : 'No image returned';
        console.debug('Canvas AI: No image in response, content:', textContent);
        throw new Error(`Image generation failed: ${textContent || 'No image returned'}`);
    }

    /**
     * Generate image using Gemini native format
     * Shared by Gemini and Yunwu providers
     * Uses camelCase parameter names: aspectRatio, imageSize
     */
    private async generateImageGeminiNative(
        instruction: string,
        imagesWithRoles: { base64: string, mimeType: string, role: string }[],
        contextText?: string,
        aspectRatio?: string,
        resolution?: string
    ): Promise<string> {
        const provider = this.getActiveProvider();
        // Build parts array in Gemini native format
        const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];

        // System context from settings
        parts.push({ text: this.settings.imageSystemPrompt || 'You are an expert creator. Use the following references.' });

        // Add images with role annotations
        for (const img of imagesWithRoles) {
            const mime = img.mimeType || 'image/png';

            // Add role label before image
            parts.push({ text: `\n[Ref: ${img.role}]` });

            // Add image as inlineData (Gemini native format)
            parts.push({
                inlineData: {
                    mimeType: mime,
                    data: img.base64
                }
            });
        }

        // Add context text if present
        if (contextText && contextText.trim()) {
            parts.push({ text: `\n[Context]\n${contextText}` });
        }

        // Add instruction
        parts.push({ text: `\nINSTRUCTION: ${instruction}` });

        // Build request body in Gemini native format
        const requestBody: GeminiRequest = {
            contents: [{
                role: 'user',
                parts: parts
            }],
            generationConfig: {
                responseModalities: ['image']  // Only request image output
            }
        };

        // Add image config with camelCase parameter names (Yunwu/Gemini native format)
        if (aspectRatio || resolution) {
            if (!requestBody.generationConfig) {
                requestBody.generationConfig = {};
            }
            requestBody.generationConfig.imageConfig = {};
            if (aspectRatio) {
                requestBody.generationConfig.imageConfig.aspectRatio = aspectRatio;
            }
            if (resolution) {
                requestBody.generationConfig.imageConfig.imageSize = resolution;
            }
        }

        console.debug(`Canvas AI: [${provider}] Sending image generation request...`);
        console.debug('Request body:', JSON.stringify(requestBody, null, 2));

        // Build endpoint URL based on provider
        const apiKey = this.getApiKey();
        let baseUrl: string;
        if (provider === 'gemini') {
            baseUrl = 'https://generativelanguage.googleapis.com';
        } else {
            baseUrl = this.settings.yunwuBaseUrl || 'https://yunwu.ai';
        }
        const model = this.getImageModel();
        const endpoint = `${baseUrl}/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const requestParams: RequestUrlParam = {
            url: endpoint,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        };

        try {
            // Use timeout for image generation (configurable, default 120s)
            const timeoutMs = (this.settings.imageGenerationTimeout || 120) * 1000;
            console.debug(`Canvas AI: Image generation timeout set to ${timeoutMs / 1000}s`);
            const response = await requestUrlWithTimeout(requestParams, timeoutMs);
            const data = response.json as GeminiResponse;

            // Parse Gemini response format
            return this.parseGeminiImageResponse(data);
        } catch (error: unknown) {
            // Check for timeout error
            const errMsg = getErrorMessage(error);
            if (errMsg.startsWith('TIMEOUT:')) {
                const timeoutSec = parseInt(errMsg.split(':')[1]) / 1000;
                console.error(`Canvas AI: Image generation timed out after ${timeoutSec}s`);
                throw new Error(`Image generation timed out after ${timeoutSec} seconds. Please try again or increase the timeout in settings.`);
            }
            if (isHttpError(error)) {
                const errorBody = error.json || { message: error.message };
                const errorMessage = (errorBody as Record<string, Record<string, string>>).error?.message || error.message;
                console.error(`Canvas AI: ${provider} HTTP Error`, error.status, errorBody);
                throw new Error(`HTTP ${error.status}: ${errorMessage}`);
            }
            throw error;
        }
    }

    /**
     * Parse Gemini image response
     * Handles both base64 and URL formats, and various MIME types
     */
    private async parseGeminiImageResponse(data: GeminiResponse): Promise<string> {
        // Gemini response format: candidates[0].content.parts[]
        const candidates = data.candidates;
        if (!candidates || candidates.length === 0) {
            throw new Error('Gemini returned no candidates');
        }

        const parts = candidates[0]?.content?.parts;
        if (!parts || parts.length === 0) {
            throw new Error('Gemini returned no parts in response');
        }

        // Find image part (skip thinking parts)
        for (const part of parts) {
            // Skip thinking parts
            if (part.thought) continue;

            // Check for inlineData (base64)
            if (part.inlineData) {
                const mimeType = part.inlineData.mimeType || 'image/png';
                const base64Data = part.inlineData.data;
                console.debug('Canvas AI: Gemini returned base64 image, mimeType:', mimeType);
                return `data:${mimeType};base64,${base64Data}`;
            }

            // Check for file_data (URL)
            if (part.file_data) {
                const url = part.file_data.file_uri;
                console.debug('Canvas AI: Gemini returned URL, fetching:', url);
                return await this.fetchImageAsDataUrl(url);
            }
        }

        // No image found, check for text content (may contain error or refusal)
        // Filter out thinking parts when getting error message
        const outputParts = parts.filter((p: GeminiPart) => p.text && !p.thought);
        const textPart = outputParts.length > 0 ? outputParts[outputParts.length - 1] : parts.find((p: GeminiPart) => p.text);
        const textContent = textPart?.text || 'No image returned';
        console.debug('Canvas AI: No image in Gemini response, text:', textContent);
        throw new Error(`Image generation failed: ${textContent}`);
    }

    /**
     * Fetch image from URL and convert to data URL
     */
    private async fetchImageAsDataUrl(url: string): Promise<string> {
        try {
            const response = await requestUrl({ url, method: 'GET' });
            const arrayBuffer = response.arrayBuffer;

            // Detect MIME type from response or URL
            let mimeType = 'image/png';
            const contentType = response.headers['content-type'];
            if (contentType) {
                mimeType = contentType.split(';')[0].trim();
            } else if (url.includes('.jpg') || url.includes('.jpeg')) {
                mimeType = 'image/jpeg';
            } else if (url.includes('.webp')) {
                mimeType = 'image/webp';
            }

            // Convert to base64
            const uint8Array = new Uint8Array(arrayBuffer);
            let binary = '';
            for (let i = 0; i < uint8Array.length; i++) {
                binary += String.fromCharCode(uint8Array[i]);
            }
            const base64Data = window.btoa(binary);

            console.debug('Canvas AI: Fetched image, mimeType:', mimeType, 'size:', arrayBuffer.byteLength);
            return `data:${mimeType};base64,${base64Data}`;
        } catch (error: unknown) {
            console.error('Canvas AI: Failed to fetch image from URL:', error);
            throw new Error(`Failed to fetch image: ${getErrorMessage(error)}`);
        }
    }

    /**
     * Send multimodal chat request with images and/or PDFs
     * @param prompt User's prompt text
     * @param mediaList Array of { base64, mimeType, type }
     * @param systemPrompt Optional system prompt
     * @param temperature Temperature for generation
     * @returns The assistant's response text
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

        // Route Gemini and Yunwu to native Gemini API format
        if (provider === 'gemini' || provider === 'yunwu') {
            return this.multimodalChatGeminiNative(prompt, mediaList, systemPrompt, temperature);
        }

        // OpenRouter uses OpenAI-compatible format
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

        // Add images and PDFs
        for (const media of mediaList) {
            const mime = media.mimeType || 'image/png';
            const url = `data:${mime};base64,${media.base64}`;

            // Note: Both images and PDFs are sent as data URLs
            // The API should handle application/pdf MIME type appropriately
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
            messages: messages,
            temperature: temperature
        };

        console.debug('Canvas AI: Sending multimodal chat request...');

        const response = await this.sendRequest(requestBody);

        if (response.error) {
            throw new Error(`OpenRouter API Error: ${response.error.message}`);
        }

        if (!response.choices || response.choices.length === 0) {
            throw new Error('OpenRouter returned no choices');
        }

        const content = response.choices[0].message.content;
        return typeof content === 'string' ? content : content.map(p => p.text || '').join('');
    }

    /**
     * Multimodal chat using Gemini native API format
     * Shared by Gemini and Yunwu providers
     */
    private async multimodalChatGeminiNative(
        prompt: string,
        mediaList: { base64: string, mimeType: string, type: 'image' | 'pdf' }[],
        systemPrompt?: string,
        temperature: number = 0.5
    ): Promise<string> {
        const provider = this.getActiveProvider();
        const apiKey = this.getApiKey();
        const model = this.getTextModel();

        // Build base URL
        let baseUrl: string;
        if (provider === 'gemini') {
            baseUrl = 'https://generativelanguage.googleapis.com';
        } else {
            baseUrl = this.settings.yunwuBaseUrl || 'https://yunwu.ai';
        }

        const endpoint = `${baseUrl}/v1beta/models/${model}:generateContent?key=${apiKey}`;

        // Build parts array in Gemini native format
        const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];

        // Add text prompt first
        parts.push({ text: prompt });

        // Add images and PDFs as inlineData
        for (const media of mediaList) {
            const mime = media.mimeType || 'image/png';
            parts.push({
                inlineData: {
                    mimeType: mime,
                    data: media.base64
                }
            });
        }

        const requestBody: GeminiRequest = {
            contents: [{
                role: 'user',
                parts: parts
            }],
            generationConfig: {
                temperature: temperature
            }
        };

        // Add system instruction if provided
        if (systemPrompt) {
            requestBody.systemInstruction = {
                parts: [{ text: systemPrompt }]
            };
        }

        console.debug(`Canvas AI: [${provider}] Sending multimodal chat request...`);

        const requestParams: RequestUrlParam = {
            url: endpoint,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        };

        try {
            const response = await requestUrl(requestParams);
            const data = response.json as GeminiResponse;

            // Parse Gemini response format
            const candidates = data.candidates;
            if (!candidates || candidates.length === 0) {
                throw new Error('Gemini returned no candidates');
            }

            const responseParts = candidates[0]?.content?.parts;
            if (!responseParts || responseParts.length === 0) {
                throw new Error('Gemini returned no parts in response');
            }

            // Find text part (filter out thinking parts for thinking models)
            // Thinking models return parts with { thought: true } for internal reasoning
            const outputParts = responseParts.filter((p: GeminiPart) => p.text && !p.thought);
            const textPart = outputParts.length > 0 ? outputParts[outputParts.length - 1] : responseParts.find((p: GeminiPart) => p.text);
            if (!textPart?.text) {
                throw new Error('Gemini returned no text in response');
            }

            console.debug(`Canvas AI: [${provider}] Received multimodal response (filtered thinking)`);
            return textPart.text;
        } catch (error: unknown) {
            if (isHttpError(error)) {
                const errorBody = error.json || { message: error.message };
                const errorMessage = (errorBody as Record<string, Record<string, string>>).error?.message || error.message;
                console.error(`Canvas AI: ${provider} HTTP Error`, error.status, errorBody);
                throw new Error(`HTTP ${error.status}: ${errorMessage}`);
            }
            throw error;
        }
    }

    /**
     * Internal method to send chat request (OpenAI-compatible format)
     * Works for both OpenRouter and Yunwu chat endpoints
     * @param body Request body
     * @param timeoutMs Optional timeout in milliseconds (used for image generation)
     */
    private async sendRequest(body: OpenRouterRequest, timeoutMs?: number): Promise<OpenRouterResponse> {
        const apiKey = this.getApiKey();

        const requestParams: RequestUrlParam = {
            url: this.getChatEndpoint(),
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
            let response;
            if (timeoutMs) {
                console.debug(`Canvas AI: Request timeout set to ${timeoutMs / 1000}s`);
                response = await requestUrlWithTimeout(requestParams, timeoutMs);
            } else {
                response = await requestUrl(requestParams);
            }
            return response.json as OpenRouterResponse;
        } catch (error: unknown) {
            // Check for timeout error
            const errMsg = getErrorMessage(error);
            if (errMsg.startsWith('TIMEOUT:')) {
                const timeoutSec = parseInt(errMsg.split(':')[1]) / 1000;
                console.error(`Canvas AI: Request timed out after ${timeoutSec}s`);
                throw new Error(`Image generation timed out after ${timeoutSec} seconds. Please try again or increase the timeout in settings.`);
            }
            // Handle HTTP errors
            if (isHttpError(error)) {
                const errorBody = error.json || { message: error.message };
                const errorMessage = (errorBody as Record<string, Record<string, string>>).error?.message || error.message;
                console.error('Canvas AI: HTTP Error', error.status, errorBody);
                throw new Error(`HTTP ${error.status}: ${errorMessage}`);
            }
            throw error;
        }
    }

    /**
     * Generate image using GPTGod
     * Handles specific resolution suffixes and aspect ratio prompts
     */
    private async generateImageGptGod(
        instruction: string,
        imagesWithRoles: { base64: string, mimeType: string, role: string }[],
        contextText?: string,
        aspectRatio?: string,
        resolution?: string
    ): Promise<string> {
        if (!this.isConfigured()) {
            throw new Error('GPTGod API Key not configured. Please set it in plugin settings.');
        }

        const contentParts: OpenRouterContentPart[] = [];

        // System context from settings
        contentParts.push({
            type: 'text',
            text: this.settings.imageSystemPrompt || 'Role: A Professional Image Creator. Use the following references for image creation.'
        });

        // Add images with role annotations
        for (const img of imagesWithRoles) {
            const mime = img.mimeType || 'image/png';
            const url = `data:${mime};base64,${img.base64}`;

            // Add role label before image
            contentParts.push({
                type: 'text',
                text: `\n[Ref: ${img.role}]`
            });

            contentParts.push({
                type: 'image_url',
                image_url: { url }
            });
        }

        // Add context text if present
        if (contextText && contextText.trim()) {
            contentParts.push({
                type: 'text',
                text: `\n[Context]\n${contextText}`
            });
        }

        // Handle Aspect Ratio via Prompt
        let finalInstruction = instruction;
        if (aspectRatio) {
            // e.g. "Aspect Ratio: 3:4"
            finalInstruction += `\nAspect Ratio: ${aspectRatio}`;
        }

        // Add instruction
        contentParts.push({
            type: 'text',
            text: `\nINSTRUCTION: ${finalInstruction}`
        });

        const messages: OpenRouterMessage[] = [{
            role: 'user',
            content: contentParts
        }];

        // Handle Resolution via Model Name Suffix
        let model = this.getImageModel();
        // Only apply suffixes if it looks like the Gemini 3 preview model (or generic if safe)
        // User example explicitly mentions gemini-3-pro-image-preview behavior
        if (resolution && model.includes('gemini-3-pro-image-preview')) {
            if (resolution === '2K') {
                model += '-2k';
            } else if (resolution === '4K') {
                model += '-4k';
            }
            // 1K or others: keep original
        }

        const requestBody: OpenRouterRequest = {
            model: model,
            messages: messages,
            // GPTGod doesn't use 'modalities' or 'image_config' in the standard way, 
            // it relies on chat completion returning image logic.
            // But we can keep it standard OpenAI chat format.
        };

        console.debug(`Canvas AI: [GPTGod] Sending image request (Model: ${model})...`);
        const timeoutMs = (this.settings.imageGenerationTimeout || 120) * 1000;

        // We reuse sendRequest which calls requestUrl
        // But GPTGod might return a response structure different from standard Chat Completion 
        // if it puts images in specific fields. sendRequest returns OpenRouterResponse (OpenAI compatible).
        // we'll cast result to any to parse flexibly.
        const responseStub = await this.sendRequest(requestBody, timeoutMs);

        return await this.parseGptGodResponse(responseStub as GptGodResponse);
    }

    /**
     * Parse GPTGod output to extract image
     * Ported/Adapted from provided example logic
     * Converts HTTP URLs to data URLs for Canvas compatibility
     */
    private async parseGptGodResponse(response: GptGodResponse): Promise<string> {
        try {

            // Helper to convert URL to data URL if needed
            const ensureDataUrl = async (url: string): Promise<string> => {
                if (url.startsWith('data:')) {
                    return url; // Already a data URL
                }
                if (url.startsWith('http://') || url.startsWith('https://')) {
                    console.debug('Canvas AI: [GPTGod] Fetching image from URL:', url);
                    return await this.fetchImageAsDataUrl(url);
                }
                // If it looks like base64 without prefix, wrap it
                if (url.match(/^[A-Za-z0-9+/=]+$/)) {
                    console.debug('Canvas AI: [GPTGod] Wrapping raw base64 as PNG');
                    return `data:image/png;base64,${url}`;
                }
                return url;
            };

            // 1. Check direct 'images' array (legacy/specific)
            if (Array.isArray(response.images) && response.images.length > 0) {
                return await ensureDataUrl(response.images[0]);
            }

            // 2. Check single 'image' field
            if (response.image && typeof response.image === 'string') {
                return await ensureDataUrl(response.image);
            }

            // 3. Check choices/messages
            if (response?.choices?.length > 0) {
                const firstChoice = response.choices[0];
                const content = firstChoice.message?.content;
                let contentText = '';

                if (typeof content === 'string') {
                    contentText = content;
                } else if (Array.isArray(content)) {
                    // OpenAI content array
                    for (const part of content) {
                        if (part?.type === 'image_url' && part?.image_url?.url) {
                            return await ensureDataUrl(part.image_url.url);
                        }
                        if (part?.type === 'text') {
                            contentText += (part.text || '') + '\n';
                        }
                    }
                }

                // If no direct image part, parse text for Markdown or URLs
                if (contentText) {
                    // Markdown image: ![...](url)
                    const mdMatch = /!\[.*?\]\((https?:\/\/[^)]+)\)/.exec(contentText);
                    if (mdMatch) {
                        console.debug('Canvas AI: [GPTGod] Found markdown image URL:', mdMatch[1]);
                        return await ensureDataUrl(mdMatch[1]);
                    }

                    // Plain URL (http...)
                    // Match url ending in image ext
                    const urlRegex = /(https?:\/\/[^\s"')<>]+\.(?:png|jpg|jpeg|webp|gif|bmp))/i;
                    const urlMatch = urlRegex.exec(contentText);
                    if (urlMatch) {
                        console.debug('Canvas AI: [GPTGod] Found plain image URL:', urlMatch[1]);
                        return await ensureDataUrl(urlMatch[1]);
                    }

                    // Check for Data URL
                    const dataRegex = /(data:image\/[^;]+;base64,[^\s"')<>]+)/i;
                    const dataMatch = dataRegex.exec(contentText);
                    if (dataMatch) return dataMatch[1];

                    // Raw URL if entire content is URL
                    if (contentText.trim().startsWith('http')) {
                        const trimmed = contentText.trim().split(/\s/)[0];
                        if (trimmed.match(/^https?:\/\//)) {
                            console.debug('Canvas AI: [GPTGod] Found raw URL:', trimmed);
                            return await ensureDataUrl(trimmed);
                        }
                    }
                }

                // Check message.image_url / message.images custom fields
                if (firstChoice.message?.image_url) {
                    return await ensureDataUrl(firstChoice.message.image_url);
                }
                if (Array.isArray(firstChoice.message?.images) && firstChoice.message.images.length > 0) {
                    const firstImg = firstChoice.message.images[0];
                    // Handle both string[] (GPTGod) and object[] (OpenRouter standard)
                    const url = typeof firstImg === 'string' ? firstImg : firstImg.image_url.url;
                    return await ensureDataUrl(url);
                }
            }

            // 4. Check Root level data/result
            if (response.data) {
                if (Array.isArray(response.data) && response.data.length > 0) {
                    const firstItem = response.data[0];
                    const url = (typeof firstItem === 'object' && firstItem !== null && 'url' in firstItem) 
                        ? (firstItem as Record<string, unknown>).url as string 
                        : (typeof firstItem === 'string' ? firstItem : null);
                    if (url) return await ensureDataUrl(url);
                }
                if (typeof response.data === 'object' && 'url' in response.data && typeof response.data.url === 'string') {
                    return await ensureDataUrl(response.data.url);
                }
            }

            // Failure
            console.warn('Canvas AI: GPTGod response structure:', JSON.stringify(response).substring(0, 500));
            throw new Error('Could not extract image from GPTGod response');

        } catch (error: unknown) {
            console.error('Canvas AI: Error parsing GPTGod response:', error);
            throw new Error(`GPTGod Response Parse Error: ${getErrorMessage(error)}`);
        }
    }
}
