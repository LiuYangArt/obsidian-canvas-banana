/**
 * OpenRouter Provider
 * 处理 OpenRouter API 调用（OpenAI 兼容格式）
 */

import { requestUrl } from 'obsidian';
import type { CanvasAISettings } from '../../settings/settings';
import type {
    OpenRouterMessage,
    OpenRouterContentPart,
    OpenRouterRequest,
    OpenRouterResponse
} from '../types';
import { isHttpError, getErrorMessage, requestUrlWithTimeout } from '../utils';

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
        const base = this.settings.openRouterBaseUrl || 'https://openrouter.ai';
        return `${base}/api/v1/chat/completions`;
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
            // eslint-disable-next-line no-restricted-globals -- Fetch is required for streaming as requestUrl does not support it
            const response = await fetch(this.getChatEndpoint(), {
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
            let hasEmittedThinkingHeader = false;

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
                                    let thinkingText = '';
                                    if (!hasEmittedThinkingHeader) {
                                        thinkingText = '> [!THINK|no-icon]- Thinking Process\n> ';
                                        hasEmittedThinkingHeader = true;
                                        isThinking = true;
                                    }
                                    thinkingText += delta.reasoning_content.replace(/\n/g, '\n> ');
                                    yield { thinking: thinkingText };
                                }

                                // 处理 content (可能含 <think> 标签)
                                if (delta.content) {
                                    let content = delta.content;
                                    
                                    // <think> 开始
                                    if (content.includes('<think>')) {
                                        if (!hasEmittedThinkingHeader) {
                                            content = content.replace('<think>', '> [!THINK|no-icon]- Thinking Process\n> ');
                                            hasEmittedThinkingHeader = true;
                                        } else {
                                            content = content.replace('<think>', '');
                                        }
                                        isThinking = true;
                                    }

                                    // </think> 结束
                                    if (content.includes('</think>')) {
                                        content = content.replace('</think>', '\n\n');
                                        isThinking = false;
                                        hasEmittedThinkingHeader = false;
                                    }

                                    // 思考中缩进
                                    if (isThinking && !content.startsWith('> [!THINK')) {
                                        content = content.replace(/\n/g, '\n> ');
                                        yield { thinking: content };
                                    } else if (!isThinking) {
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
                requestBody.image_config.aspect_ratio = aspectRatio as '1:1' | '16:9' | '4:3' | '9:16';
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
        throw new Error(`Image generation failed: ${textContent || 'No image returned'}`);
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

        console.debug('Canvas AI: [OpenRouter] Sending multimodal chat request...');
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
