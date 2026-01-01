/**
 * GptGod Provider
 * 处理 GPTGod API 的图片生成
 */

import { requestUrl } from 'obsidian';
import type { CanvasAISettings } from '../../settings/settings';
import type {
    OpenRouterMessage,
    OpenRouterContentPart,
    OpenRouterRequest,
    OpenRouterResponse,
    GptGodResponse
} from '../types';
import { isHttpError, getErrorMessage, requestUrlWithTimeout } from '../utils';

export class GptGodProvider {
    private settings: CanvasAISettings;

    constructor(settings: CanvasAISettings) {
        this.settings = settings;
    }

    updateSettings(settings: CanvasAISettings): void {
        this.settings = settings;
    }

    getApiKey(): string {
        return this.settings.gptGodApiKey || '';
    }

    getTextModel(): string {
        return this.settings.gptGodTextModel || 'gpt-4-gizmo-g-2fkFE8rbu';
    }

    getImageModel(): string {
        return this.settings.gptGodImageModel || 'gemini-3-pro-image-preview';
    }

    private getChatEndpoint(): string {
        const base = this.settings.gptGodBaseUrl || 'https://api.gptgod.online';
        return `${base}/v1/chat/completions`;
    }

    /**
     * Chat completion
     */
    async chatCompletion(prompt: string, systemPrompt?: string, temperature: number = 0.5): Promise<string> {
        const messages: OpenRouterMessage[] = [];

        if (systemPrompt) {
            messages.push({ role: 'system', content: systemPrompt });
        }
        messages.push({ role: 'user', content: prompt });

        const requestBody: OpenRouterRequest = {
            model: this.getTextModel(),
            messages: messages,
            temperature: temperature
        };

        console.debug('Canvas AI: [GPTGod] Sending chat request...');
        const response = await this.sendRequest(requestBody);

        if (response.error) {
            throw new Error(`GPTGod API Error: ${response.error.message}`);
        }

        if (!response.choices || response.choices.length === 0) {
            throw new Error('GPTGod returned no choices');
        }

        const content = response.choices[0].message.content;
        return typeof content === 'string' ? content : content.map(p => p.text || '').join('');
    }

    /**
     * Generate image
     */
    async generateImage(
        instruction: string,
        imagesWithRoles: { base64: string, mimeType: string, role: string }[],
        contextText?: string,
        aspectRatio?: string,
        resolution?: string
    ): Promise<string> {
        const contentParts: OpenRouterContentPart[] = [];

        // System context
        contentParts.push({
            type: 'text',
            text: this.settings.imageSystemPrompt || 'Role: A Professional Image Creator. Use the following references for image creation.'
        });

        // Add images with role annotations
        for (const img of imagesWithRoles) {
            const mime = img.mimeType || 'image/png';
            const url = `data:${mime};base64,${img.base64}`;

            contentParts.push({ type: 'text', text: `\n[Ref: ${img.role}]` });
            contentParts.push({ type: 'image_url', image_url: { url } });
        }

        // Add context text
        if (contextText && contextText.trim()) {
            contentParts.push({ type: 'text', text: `\n[Context]\n${contextText}` });
        }

        // Handle Aspect Ratio via Prompt
        let finalInstruction = instruction;
        if (aspectRatio) {
            finalInstruction += `\nAspect Ratio: ${aspectRatio}`;
        }

        contentParts.push({ type: 'text', text: `\nINSTRUCTION: ${finalInstruction}` });

        const messages: OpenRouterMessage[] = [{ role: 'user', content: contentParts }];

        // Handle Resolution via Model Name Suffix
        let model = this.getImageModel();
        if (resolution && model.includes('gemini-3-pro-image-preview')) {
            if (resolution === '2K') {
                model += '-2k';
            } else if (resolution === '4K') {
                model += '-4k';
            }
        }

        const requestBody: OpenRouterRequest = {
            model: model,
            messages: messages,
        };

        console.debug(`Canvas AI: [GPTGod] Sending image request (Model: ${model})...`);
        const timeoutMs = (this.settings.imageGenerationTimeout || 120) * 1000;
        const response = await this.sendRequest(requestBody, timeoutMs);

        return await this.parseGptGodResponse(response as GptGodResponse);
    }

    /**
     * Multimodal chat
     */
    async multimodalChat(
        prompt: string,
        mediaList: { base64: string, mimeType: string, type: 'image' | 'pdf' }[],
        systemPrompt?: string,
        temperature: number = 0.5
    ): Promise<string> {
        const messages: OpenRouterMessage[] = [];

        if (systemPrompt) {
            messages.push({ role: 'system', content: systemPrompt });
        }

        const contentParts: OpenRouterContentPart[] = [{ type: 'text', text: prompt }];

        for (const media of mediaList) {
            const mime = media.mimeType || 'image/png';
            const url = `data:${mime};base64,${media.base64}`;
            contentParts.push({ type: 'image_url', image_url: { url } });
        }

        messages.push({ role: 'user', content: contentParts });

        const requestBody: OpenRouterRequest = {
            model: this.getTextModel(),
            messages: messages,
            temperature: temperature
        };

        console.debug('Canvas AI: [GPTGod] Sending multimodal chat request...');
        const response = await this.sendRequest(requestBody);

        if (response.error) {
            throw new Error(`GPTGod API Error: ${response.error.message}`);
        }

        if (!response.choices || response.choices.length === 0) {
            throw new Error('GPTGod returned no choices');
        }

        const content = response.choices[0].message.content;
        return typeof content === 'string' ? content : content.map(p => p.text || '').join('');
    }

    private async sendRequest(body: OpenRouterRequest, timeoutMs?: number): Promise<OpenRouterResponse> {
        const apiKey = this.getApiKey();

        const requestParams = {
            url: this.getChatEndpoint(),
            method: 'POST' as const,
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
                response = await requestUrlWithTimeout(requestParams, timeoutMs);
            } else {
                response = await requestUrl(requestParams);
            }
            return response.json as OpenRouterResponse;
        } catch (error: unknown) {
            const errMsg = getErrorMessage(error);
            if (errMsg.startsWith('TIMEOUT:')) {
                const timeoutSec = parseInt(errMsg.split(':')[1]) / 1000;
                throw new Error(`Image generation timed out after ${timeoutSec} seconds.`);
            }
            if (isHttpError(error)) {
                const errorBody = error.json || { message: error.message };
                const errorMessage = (errorBody as Record<string, Record<string, string>>).error?.message || error.message;
                throw new Error(`HTTP ${error.status}: ${errorMessage}`);
            }
            throw error;
        }
    }

    /**
     * Fetch image from URL and convert to data URL
     */
    private async fetchImageAsDataUrl(url: string): Promise<string> {
        try {
            const response = await requestUrl({ url, method: 'GET' });
            const arrayBuffer = response.arrayBuffer;

            let mimeType = 'image/png';
            const contentType = response.headers['content-type'];
            if (contentType) {
                mimeType = contentType.split(';')[0].trim();
            } else if (url.includes('.jpg') || url.includes('.jpeg')) {
                mimeType = 'image/jpeg';
            } else if (url.includes('.webp')) {
                mimeType = 'image/webp';
            }

            const uint8Array = new Uint8Array(arrayBuffer);
            let binary = '';
            for (let i = 0; i < uint8Array.length; i++) {
                binary += String.fromCharCode(uint8Array[i]);
            }
            const base64Data = window.btoa(binary);

            return `data:${mimeType};base64,${base64Data}`;
        } catch (error: unknown) {
            throw new Error(`Failed to fetch image: ${getErrorMessage(error)}`);
        }
    }

    /**
     * Parse GPTGod response to extract image
     */
    private async parseGptGodResponse(response: GptGodResponse): Promise<string> {
        const ensureDataUrl = async (url: string): Promise<string> => {
            if (url.startsWith('data:')) return url;
            if (url.startsWith('http://') || url.startsWith('https://')) {
                console.debug('Canvas AI: [GPTGod] Fetching image from URL:', url);
                return await this.fetchImageAsDataUrl(url);
            }
            if (url.match(/^[A-Za-z0-9+/=]+$/)) {
                return `data:image/png;base64,${url}`;
            }
            return url;
        };

        // Check direct 'images' array
        if (Array.isArray(response.images) && response.images.length > 0) {
            return await ensureDataUrl(response.images[0]);
        }

        // Check single 'image' field
        if (response.image && typeof response.image === 'string') {
            return await ensureDataUrl(response.image);
        }

        // Check choices/messages
        if (response?.choices?.length > 0) {
            const firstChoice = response.choices[0];
            const content = firstChoice.message?.content;
            let contentText = '';

            if (typeof content === 'string') {
                contentText = content;
            } else if (Array.isArray(content)) {
                for (const part of content) {
                    if (part?.type === 'image_url' && part?.image_url?.url) {
                        return await ensureDataUrl(part.image_url.url);
                    }
                    if (part?.type === 'text') {
                        contentText += (part.text || '') + '\n';
                    }
                }
            }

            if (contentText) {
                // Markdown image
                const mdMatch = /!\[.*?\]\((https?:\/\/[^)]+)\)/.exec(contentText);
                if (mdMatch) return await ensureDataUrl(mdMatch[1]);

                // Plain URL
                const urlRegex = /(https?:\/\/[^\s"')<>]+\.(?:png|jpg|jpeg|webp|gif|bmp))/i;
                const urlMatch = urlRegex.exec(contentText);
                if (urlMatch) return await ensureDataUrl(urlMatch[1]);

                // Data URL
                const dataRegex = /(data:image\/[^;]+;base64,[^\s"')<>]+)/i;
                const dataMatch = dataRegex.exec(contentText);
                if (dataMatch) return dataMatch[1];

                // Raw URL
                if (contentText.trim().startsWith('http')) {
                    const trimmed = contentText.trim().split(/\s/)[0];
                    if (trimmed.match(/^https?:\/\//)) {
                        return await ensureDataUrl(trimmed);
                    }
                }
            }

            if (firstChoice.message?.image_url) {
                return await ensureDataUrl(firstChoice.message.image_url);
            }
            if (Array.isArray(firstChoice.message?.images) && firstChoice.message.images.length > 0) {
                const firstImg = firstChoice.message.images[0];
                const url = typeof firstImg === 'string' ? firstImg : firstImg.image_url.url;
                return await ensureDataUrl(url);
            }
        }

        // Check root data field
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

        throw new Error('Could not extract image from GPTGod response');
    }
}
