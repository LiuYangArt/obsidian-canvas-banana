/**
 * OpenRouter Provider
 * 处理 OpenRouter API 调用（OpenAI 兼容格式）
 */

import { requestUrl } from 'obsidian';
import type { CanvasAISettings } from '../../settings/settings';
import type {
    OpenRouterAspectRatio,
    OpenRouterChoice,
    OpenRouterMessage,
    OpenRouterContentPart,
    OpenRouterRequest,
    OpenRouterResponse
} from '../types';
import { isHttpError, getErrorMessage, requestUrlWithTimeout, buildVersionedApiEndpoint } from '../utils';

export class OpenRouterProvider {
    private settings: CanvasAISettings;

    constructor(settings: CanvasAISettings) {
        this.settings = settings;
    }

    updateSettings(settings: CanvasAISettings): void {
        this.settings = settings;
    }

    getApiKey(): string {
        return this.settings.openRouterApiKey || '';
    }

    getTextModel(): string {
        return this.settings.openRouterTextModel || 'google/gemini-2.0-flash-001';
    }

    getImageModel(): string {
        return this.settings.openRouterImageModel || 'google/gemini-2.0-flash-001';
    }

    private getChatEndpoint(): string {
        const base = this.settings.openRouterBaseUrl || 'https://openrouter.ai/api';
        return buildVersionedApiEndpoint(base, 'v1', 'chat/completions');
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

        console.debug('Canvas AI: [OpenRouter] Sending chat request...');
        const response = await this.sendRequest(requestBody);

        if (response.error) {
            throw new Error(`OpenRouter API Error: ${response.error.message}`);
        }

        if (!response.choices || response.choices.length === 0) {
            throw new Error('OpenRouter returned no choices');
        }

        const content = response.choices[0].message.content;
        console.debug('Canvas AI: Received response:', typeof content === 'string' ? content.substring(0, 100) : 'multimodal content');

        return typeof content === 'string' ? content : content.map(p => p.text || '').join('');
    }

    /**
     * Chat completion with streaming
     */
    async *streamChatCompletion(prompt: string, systemPrompt?: string, temperature: number = 0.5): AsyncGenerator<{ content?: string; thinking?: string }, void, unknown> {
        const messages: OpenRouterMessage[] = [];

        if (systemPrompt) {
            messages.push({ role: 'system', content: systemPrompt });
        }
        messages.push({ role: 'user', content: prompt });

        const requestBody: OpenRouterRequest = {
            model: this.getTextModel(),
            messages: messages,
            temperature: temperature,
            // @ts-ignore: stream property is not in the interface but required for streaming
            stream: true
        };

        const apiKey = this.getApiKey();
        console.debug('Canvas AI: [OpenRouter] Sending stream chat request...');

        try {
            const response = await globalThis.fetch(this.getChatEndpoint(), {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://obsidian.md',
                    'X-Title': 'Obsidian Canvas AI'
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`OpenRouter API Error: ${response.status} ${errorText}`);
            }

            if (!response.body) {
                throw new Error('Response body is null');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';
            let isThinking = false;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                buffer += chunk;
                const lines = buffer.split('\n');
                
                // Process all complete lines
                buffer = lines.pop() || ''; // Keep the last partial line in buffer

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed === 'data: [DONE]') continue;
                    
                    if (trimmed.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(trimmed.slice(6));
                            const delta = data.choices?.[0]?.delta;
                            
                            // Debug: 输出完整 delta
                            if (delta) {
                                console.debug('Canvas AI: [OpenRouter] Stream delta:', JSON.stringify(delta));
                                
                                // 处理 reasoning_content (DeepSeek R1 等)
                                if (delta.reasoning_content) {
                                    yield { thinking: delta.reasoning_content };
                                }

                                // 处理 content (可能含 <think> 标签)
                                if (delta.content) {
                                    let content = delta.content;
                                    
                                    if (content.includes('<think>')) {
                                        isThinking = true;
                                        content = content.replace('<think>', '');
                                    }

                                    if (content.includes('</think>')) {
                                        const parts = content.split('</think>');
                                        if (parts[0] && isThinking) {
                                            yield { thinking: parts[0] };
                                        }
                                        isThinking = false;
                                        if (parts[1]) {
                                            yield { content: parts[1] };
                                        }
                                    } else if (isThinking) {
                                        yield { thinking: content };
                                    } else if (content) {
                                        yield { content };
                                    }
                                }
                            }
                        } catch (e) {
                            console.warn('Error parsing stream chunk:', e);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Canvas AI: Stream Error', error);
            throw error;
        }
    }


    /**
     * Generate image with roles
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
            text: this.settings.imageSystemPrompt || 'You are an expert creator. Use the following references.'
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

        // Add instruction
        contentParts.push({ type: 'text', text: `\nINSTRUCTION: ${instruction}` });

        const messages: OpenRouterMessage[] = [{ role: 'user', content: contentParts }];

        const requestBody: OpenRouterRequest = {
            model: this.getImageModel(),
            messages,
            modalities: ['image']
        };

        if (aspectRatio || resolution) {
            requestBody.image_config = {};
            if (aspectRatio) {
                requestBody.image_config.aspect_ratio = aspectRatio as OpenRouterAspectRatio;
            }
            if (resolution) {
                requestBody.image_config.image_size = resolution;
            }
        }

        console.debug('Canvas AI: [OpenRouter] Sending image generation request...');

        const timeoutMs = (this.settings.imageGenerationTimeout || 120) * 1000;
        const response = await this.sendRequest(requestBody, timeoutMs);

        if (response.error) {
            throw new Error(`OpenRouter API Error: ${response.error.message}`);
        }

        if (!response.choices || response.choices.length === 0) {
            throw new Error('OpenRouter returned no choices');
        }

        const message = response.choices[0].message;
        const imageUrl = await this.extractImageFromMessage(message);
        if (imageUrl) {
            console.debug('Canvas AI: Received image, length:', imageUrl.length);
            return imageUrl;
        }

        const textContent = typeof message.content === 'string'
            ? message.content
            : Array.isArray(message.content)
                ? message.content.map(p => p.text || '').join('')
                : 'No image returned';
        throw new Error(`Image generation failed: ${textContent || 'No image returned'}`);
    }

    /**
     * Multimodal chat - returns content and optional thinking
     */
    async multimodalChat(
        prompt: string,
        mediaList: { base64: string, mimeType: string, type: 'image' | 'pdf' }[],
        systemPrompt?: string,
        temperature: number = 0.5
    ): Promise<{ content: string; thinking?: string }> {
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

        console.debug('Canvas AI: [OpenRouter] Sending multimodal chat request...');
        const response = await this.sendRequest(requestBody);

        if (response.error) {
            throw new Error(`OpenRouter API Error: ${response.error.message}`);
        }

        if (!response.choices || response.choices.length === 0) {
            throw new Error('OpenRouter returned no choices');
        }

        const message = response.choices[0].message;
        let content = typeof message.content === 'string' 
            ? message.content 
            : message.content.map(p => p.text || '').join('');
        
        // Extract thinking from reasoning_content or <think> tags
        let thinking: string | undefined;
        
        // Check for reasoning_content (DeepSeek R1 style)
        const reasoningContent = message.reasoning_content;
        if (reasoningContent) {
            thinking = reasoningContent;
        }
        
        // Also check for <think> tags in content
        const thinkMatch = content.match(/^<think>([\s\S]*?)<\/think>/);
        if (thinkMatch) {
            thinking = (thinking || '') + thinkMatch[1];
            content = content.replace(/^<think>[\s\S]*?<\/think>/, '').trim();
        }

        return { content, thinking: thinking || undefined };
    }

    private async extractImageFromMessage(message: OpenRouterChoice['message']): Promise<string | null> {
        if (message.images && message.images.length > 0) {
            const firstImage = message.images[0];
            const firstRef = typeof firstImage === 'string' ? firstImage : firstImage.image_url.url;
            const normalized = await this.normalizeImageRef(firstRef);
            if (normalized) return normalized;
        }

        if (message.image_url) {
            const normalized = await this.normalizeImageRef(message.image_url);
            if (normalized) return normalized;
        }

        if (Array.isArray(message.content)) {
            let textContent = '';
            for (const part of message.content) {
                if (part?.type === 'image_url' && part.image_url?.url) {
                    const normalized = await this.normalizeImageRef(part.image_url.url);
                    if (normalized) return normalized;
                }
                if (part?.type === 'text' && part.text) {
                    textContent += `${part.text}\n`;
                }
            }
            const fromText = await this.extractImageFromText(textContent);
            if (fromText) return fromText;
            return null;
        }

        if (typeof message.content === 'string') {
            return await this.extractImageFromText(message.content);
        }

        return null;
    }

    private async extractImageFromText(text: string): Promise<string | null> {
        if (!text) return null;

        // Markdown image: ![alt](...)
        const markdownMatch = /!\[[^\]]*]\(([^)]+)\)/i.exec(text);
        if (markdownMatch?.[1]) {
            const normalized = await this.normalizeImageRef(markdownMatch[1].trim());
            if (normalized) return normalized;
        }

        // Direct data URL
        const dataUrlMatch = /(data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/_=-]+)/i.exec(text);
        if (dataUrlMatch?.[1]) return dataUrlMatch[1];

        // Plain image URL with extension
        const imageUrlMatch = /(https?:\/\/[^\s"')<>]+\.(?:png|jpg|jpeg|webp|gif|bmp))/i.exec(text);
        if (imageUrlMatch?.[1]) {
            return await this.fetchImageAsDataUrl(imageUrlMatch[1]);
        }

        // Raw URL without extension
        const firstToken = text.trim().split(/\s+/)[0] || '';
        if (/^https?:\/\//i.test(firstToken)) {
            return await this.fetchImageAsDataUrl(firstToken);
        }

        return null;
    }

    private async normalizeImageRef(ref: string): Promise<string | null> {
        if (!ref) return null;

        if (ref.startsWith('data:image/')) return ref;
        if (/^https?:\/\//i.test(ref)) return await this.fetchImageAsDataUrl(ref);
        if (/^[A-Za-z0-9+/=]+$/.test(ref)) return `data:image/png;base64,${ref}`;
        return null;
    }

    private async fetchImageAsDataUrl(url: string): Promise<string> {
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
                console.debug(`Canvas AI: Request timeout set to ${timeoutMs / 1000}s`);
                response = await requestUrlWithTimeout(requestParams, timeoutMs);
            } else {
                response = await requestUrl(requestParams);
            }
            return response.json as OpenRouterResponse;
        } catch (error: unknown) {
            const errMsg = getErrorMessage(error);
            if (errMsg.startsWith('TIMEOUT:')) {
                const timeoutSec = parseInt(errMsg.split(':')[1]) / 1000;
                throw new Error(`Request timed out after ${timeoutSec} seconds.`);
            }
            if (isHttpError(error)) {
                const errorBody = error.json || { message: error.message };
                const errorMessage = (errorBody as Record<string, Record<string, string>>).error?.message || error.message;
                console.error('Canvas AI: HTTP Error', error.status, errorBody);
                throw new Error(`HTTP ${error.status}: ${errorMessage}`);
            }
            throw error;
        }
    }
}
