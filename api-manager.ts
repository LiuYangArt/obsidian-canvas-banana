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
     * Get the current active provider
     */
    private getActiveProvider(): 'openrouter' | 'yunwu' {
        return this.settings.apiProvider || 'openrouter';
    }

    /**
     * Get the API key to use based on active provider
     */
    private getApiKey(): string {
        if (this.getActiveProvider() === 'yunwu') {
            return this.settings.yunwuApiKey || '';
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
        return this.settings.openRouterBaseUrl || 'https://openrouter.ai/api/v1/chat/completions';
    }

    /**
     * Get text generation model based on active provider
     */
    private getTextModel(): string {
        const provider = this.getActiveProvider();
        if (provider === 'yunwu') {
            return this.settings.yunwuTextModel || 'gemini-2.0-flash';
        }
        return this.settings.openRouterTextModel || 'google/gemini-2.0-flash-001';
    }

    /**
     * Get image generation model based on active provider
     */
    private getImageModel(): string {
        const provider = this.getActiveProvider();
        if (provider === 'yunwu') {
            return this.settings.yunwuImageModel || 'gemini-3-pro-image-preview';
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
        if (this.getActiveProvider() === 'yunwu') {
            return this.generateImageYunwu(instruction, imagesWithRoles, contextText, aspectRatio, resolution);
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
                requestBody.image_config.aspect_ratio = aspectRatio as any;
            }
            if (resolution) {
                requestBody.image_config.image_size = resolution;
            }
        }

        console.log('Canvas AI: [OpenRouter] Sending image generation request...');
        console.log('Request body:', JSON.stringify(requestBody, null, 2));

        const response = await this.sendRequest(requestBody);

        if (response.error) {
            throw new Error(`OpenRouter API Error: ${response.error.message}`);
        }

        if (!response.choices || response.choices.length === 0) {
            throw new Error('OpenRouter returned no choices');
        }

        const message = response.choices[0].message;

        if (message.images && message.images.length > 0) {
            const imageUrl = message.images[0].image_url.url;
            console.log('Canvas AI: Received image, length:', imageUrl.length);
            return imageUrl;
        }

        console.log('Canvas AI: No image in response, content:', message.content);
        throw new Error(`Image generation failed: ${message.content || 'No image returned'}`);
    }

    /**
     * Generate image using Yunwu native Gemini format
     * Uses different parameter names: aspectRatio (no underscore), imageSize (no underscore)
     */
    private async generateImageYunwu(
        instruction: string,
        imagesWithRoles: { base64: string, mimeType: string, role: string }[],
        contextText?: string,
        aspectRatio?: string,
        resolution?: string
    ): Promise<string> {
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
        const requestBody: any = {
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
            requestBody.generationConfig.imageConfig = {};
            if (aspectRatio) {
                requestBody.generationConfig.imageConfig.aspectRatio = aspectRatio;
            }
            if (resolution) {
                requestBody.generationConfig.imageConfig.imageSize = resolution;
            }
        }

        console.log('Canvas AI: [Yunwu] Sending image generation request...');
        console.log('Request body:', JSON.stringify(requestBody, null, 2));

        // Yunwu image generation uses a different endpoint
        const apiKey = this.getApiKey();
        const baseUrl = this.settings.yunwuBaseUrl || 'https://yunwu.ai';
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
            const response = await requestUrl(requestParams);
            const data = response.json;

            // Parse Yunwu/Gemini response format
            return this.parseYunwuImageResponse(data);
        } catch (error: any) {
            if (error.status) {
                const errorBody = error.json || { message: error.message };
                console.error('Canvas AI: Yunwu HTTP Error', error.status, errorBody);
                throw new Error(`HTTP ${error.status}: ${errorBody.error?.message || error.message}`);
            }
            throw error;
        }
    }

    /**
     * Parse Yunwu/Gemini image response
     * Handles both base64 and URL formats, and various MIME types
     */
    private async parseYunwuImageResponse(data: any): Promise<string> {
        // Gemini response format: candidates[0].content.parts[]
        const candidates = data.candidates;
        if (!candidates || candidates.length === 0) {
            throw new Error('Yunwu returned no candidates');
        }

        const parts = candidates[0]?.content?.parts;
        if (!parts || parts.length === 0) {
            throw new Error('Yunwu returned no parts in response');
        }

        // Find image part
        for (const part of parts) {
            // Check for inlineData (base64)
            if (part.inlineData) {
                const mimeType = part.inlineData.mimeType || 'image/png';
                const base64Data = part.inlineData.data;
                console.log('Canvas AI: Yunwu returned base64 image, mimeType:', mimeType);
                return `data:${mimeType};base64,${base64Data}`;
            }

            // Check for file_data (URL)
            if (part.file_data) {
                const url = part.file_data.file_uri;
                console.log('Canvas AI: Yunwu returned URL, fetching:', url);
                return await this.fetchImageAsDataUrl(url);
            }
        }

        // No image found, check for text content (may contain error or refusal)
        const textPart = parts.find((p: any) => p.text);
        const textContent = textPart?.text || 'No image returned';
        console.log('Canvas AI: No image in Yunwu response, text:', textContent);
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

            console.log('Canvas AI: Fetched image, mimeType:', mimeType, 'size:', arrayBuffer.byteLength);
            return `data:${mimeType};base64,${base64Data}`;
        } catch (error: any) {
            console.error('Canvas AI: Failed to fetch image from URL:', error);
            throw new Error(`Failed to fetch image: ${error.message}`);
        }
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
     * Internal method to send chat request (OpenAI-compatible format)
     * Works for both OpenRouter and Yunwu chat endpoints
     */
    private async sendRequest(body: OpenRouterRequest): Promise<OpenRouterResponse> {
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
