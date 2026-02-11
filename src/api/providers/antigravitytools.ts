/**
 * AntigravityTools Provider
 * 文字生成使用 Gemini 原生 API，图片生成使用 OpenAI 兼容 API
 */

import { requestUrl, RequestUrlParam } from 'obsidian';
import type { CanvasAISettings } from '../../settings/settings';
import type { GeminiRequest, GeminiResponse, GeminiPart, GeminiContent } from '../types';
import { isHttpError, getErrorMessage, requestUrlWithTimeout } from '../utils';


export class AntigravityToolsProvider {
    private settings: CanvasAISettings;

    constructor(settings: CanvasAISettings) {
        this.settings = settings;
    }

    updateSettings(settings: CanvasAISettings): void {
        this.settings = settings;
    }

    getApiKey(): string {
        return this.settings.antigravityToolsApiKey || '';
    }

    getTextModel(): string {
        return this.settings.antigravityToolsTextModel || 'gemini-3-flash';
    }

    getImageModel(): string {
        return this.settings.antigravityToolsImageModel || 'gemini-3-pro-image';
    }

    private getBaseUrl(): string {
        return this.settings.antigravityToolsBaseUrl || 'http://127.0.0.1:8045';
    }

    // Gemini 原生 API 端点 (用于文字生成)
    private getGeminiEndpoint(model: string): string {
        const baseUrl = this.getBaseUrl();
        const apiKey = this.getApiKey();
        return `${baseUrl}/v1beta/models/${model}:generateContent?key=${apiKey}`;
    }

    // OpenAI 兼容图片生成端点
    private getImageEndpoint(): string {
        const baseUrl = this.getBaseUrl();
        return `${baseUrl}/v1/images/generations`;
    }

    // OpenAI 兼容 chat/completions 端点 (用于图生图)
    private getChatEndpoint(): string {
        const baseUrl = this.getBaseUrl();
        return `${baseUrl}/v1/chat/completions`;
    }

    /**
     * 将 aspectRatio 转换为 OpenAI size 格式
     */
    private aspectRatioToSize(aspectRatio?: string): string {
        switch (aspectRatio) {
            case '21:9': return '1792x768';
            case '16:9': return '1792x1024';
            case '9:16': return '1024x1792';
            case '4:3': return '1024x768';
            case '3:4': return '768x1024';
            case '1:1':
            default: return '1024x1024';
        }
    }

    /**
     * 将 aspectRatio 转换为模型后缀格式 (用于 chat/completions)
     * 例如 16:9 -> 16x9
     */
    private aspectRatioToSuffix(aspectRatio?: string): string {
        if (!aspectRatio) return '';
        return aspectRatio.replace(':', 'x');
    }

    /**
     * 构建带后缀的模型名
     * 格式: gemini-3-pro-image[-resolution][-ratio]
     */
    private buildModelWithSuffix(aspectRatio?: string, resolution?: string): string {
        let model = this.getImageModel();
        
        // 添加分辨率后缀 (仅支持 4k/hd，2k 暂不支持)
        if (resolution) {
            const resLower = resolution.toLowerCase();
            if (resLower === '4k' || resLower === '2k' || resLower === 'hd') {
                model += `-${resLower}`;
            }
        }
        
        // 添加比例后缀 (16x9, 9x16, 4x3, 3x4, 1x1)
        const ratioSuffix = this.aspectRatioToSuffix(aspectRatio);
        if (ratioSuffix && ratioSuffix !== '1x1') {
            model += `-${ratioSuffix}`;
        }
        
        return model;
    }

    /**
     * Chat completion - 使用 Gemini 原生格式
     */
    /**
     * Chat completion - 使用 Gemini 原生格式
     * Now supports optional history for multi-turn chat with thought signatures
     */
    async chatCompletion(
        prompt: string | GeminiContent[],
        systemPrompt?: string,
        temperature: number = 1.0
    ): Promise<string> {
        const model = this.getTextModel();
        const endpoint = this.getGeminiEndpoint(model);

        let contents: GeminiContent[] = [];

        if (typeof prompt === 'string') {
            // Legacy/Single turn mode
            contents = [{ role: 'user', parts: [{ text: prompt }] }];
        } else {
            // Native history mode
            contents = prompt;
        }

        const requestBody: GeminiRequest = {
            contents: contents,
            generationConfig: { temperature: temperature }
        };

        if (systemPrompt) {
            requestBody.systemInstruction = { parts: [{ text: systemPrompt }] };
        }

        console.debug('Canvas AI: [AntigravityTools] Sending chat request...');

        const requestParams: RequestUrlParam = {
            url: endpoint,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        };

        try {
            const response = await requestUrl(requestParams);
            const data = response.json as GeminiResponse;
            return this.extractTextFromResponse(data);
        } catch (error: unknown) {
            this.handleError(error);
        }
    }

    /**
     * Generate image - 统一使用 /v1/chat/completions 端点
     * 文生图和图生图都走同一路径，后端通过模型后缀控制比例和分辨率
     */
    async generateImage(
        instruction: string,
        imagesWithRoles: { base64: string, mimeType: string, role: string }[],
        contextText?: string,
        aspectRatio?: string,
        resolution?: string
    ): Promise<string> {
        return this.generateImageWithChat(instruction, imagesWithRoles, contextText, aspectRatio, resolution);
    }


    /**
     * 图生图 - 使用 OpenAI /v1/chat/completions (类似 GptGod)
     */
    private async generateImageWithChat(
        instruction: string,
        imagesWithRoles: { base64: string, mimeType: string, role: string }[],
        contextText?: string,
        aspectRatio?: string,
        resolution?: string
    ): Promise<string> {
        const endpoint = this.getChatEndpoint();

        // 构建 content parts
        const contentParts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];

        // 系统上下文
        const systemPrompt = this.settings.imageSystemPrompt || 'You are an expert creator. Use the following references.';
        contentParts.push({ type: 'text', text: systemPrompt });

        // 添加参考图片
        for (const img of imagesWithRoles) {
            const mime = img.mimeType || 'image/png';
            const dataUrl = `data:${mime};base64,${img.base64}`;

            contentParts.push({ type: 'text', text: `\n[Ref: ${img.role}]` });
            contentParts.push({ type: 'image_url', image_url: { url: dataUrl } });
        }

        // 添加上下文文本
        if (contextText && contextText.trim()) {
            contentParts.push({ type: 'text', text: `\n[Context]\n${contextText}` });
        }

        // 添加指令
        contentParts.push({ type: 'text', text: `\nINSTRUCTION: ${instruction}` });

        // 构建带后缀的模型名来控制分辨率和比例
        const model = this.buildModelWithSuffix(aspectRatio, resolution);

        const requestBody = {
            model: model,
            messages: [{ role: 'user', content: contentParts }]
        };

        console.debug(`Canvas AI: [AntigravityTools] Image-to-Image via /v1/chat/completions (Model: ${model})`);

        const requestParams: RequestUrlParam = {
            url: endpoint,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.getApiKey()}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        };

        try {
            const timeoutMs = (this.settings.imageGenerationTimeout || 120) * 1000;
            const response = await requestUrlWithTimeout(requestParams, timeoutMs);
            const data = response.json;

            return await this.parseChatImageResponse(data);
        } catch (error: unknown) {
            const errMsg = getErrorMessage(error);
            if (errMsg.startsWith('TIMEOUT:')) {
                const timeoutSec = parseInt(errMsg.split(':')[1]) / 1000;
                throw new Error(`Image generation timed out after ${timeoutSec} seconds.`);
            }
            this.handleError(error);
        }
    }

    /**
     * 解析 chat/completions 响应中的图片
     */
    private async parseChatImageResponse(response: Record<string, unknown>): Promise<string> {
        const ensureDataUrl = async (url: string): Promise<string> => {
            if (url.startsWith('data:')) return url;
            if (url.startsWith('http://') || url.startsWith('https://')) {
                return await this.fetchImageAsDataUrl(url);
            }
            // Raw base64
            if (url.match(/^[A-Za-z0-9+/=]+$/)) {
                return `data:image/png;base64,${url}`;
            }
            return url;
        };

        // Check choices/messages
        const choices = response.choices as Array<{ message?: { content?: unknown } }> | undefined;
        if (choices && choices.length > 0) {
            const content = choices[0].message?.content;
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
            }
        }

        throw new Error('Could not extract image from AntigravityTools response');
    }

    /**
     * Multimodal chat - 使用 Gemini 原生格式，返回 content 和 thinking
     */
    async multimodalChat(
        prompt: string,
        mediaList: { base64: string, mimeType: string, type: 'image' | 'pdf' }[],
        systemPrompt?: string,
        temperature: number = 1.0,
        thinkingConfig?: { enabled: boolean; budgetTokens?: number; level?: 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH' }
    ): Promise<{ content: string; thinking?: string }> {
        const model = this.getTextModel();
        const endpoint = this.getGeminiEndpoint(model);

        const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];

        // 添加文本 prompt
        parts.push({ text: prompt });

        // 添加图片和 PDF
        for (const media of mediaList) {
            const mime = media.mimeType || 'image/png';
            parts.push({ inlineData: { mimeType: mime, data: media.base64 } });
        }

        const requestBody: GeminiRequest = {
            contents: [{ role: 'user', parts: parts }],
            generationConfig: { temperature: temperature }
        };

        if (thinkingConfig?.enabled) {
            const genConfig = requestBody.generationConfig!;
            genConfig.thinkingConfig = {
                includeThoughts: true
            };
            if (thinkingConfig.level) {
                genConfig.thinkingConfig.thinkingLevel = thinkingConfig.level;
            } else {
                genConfig.thinkingConfig.thinkingBudget = thinkingConfig.budgetTokens || 8192;
            }
            console.debug('Canvas AI: [AntigravityTools] Multimodal Thinking enabled:', JSON.stringify(genConfig.thinkingConfig));
        }

        if (systemPrompt) {
            requestBody.systemInstruction = { parts: [{ text: systemPrompt }] };
        }

        console.debug('Canvas AI: [AntigravityTools] Sending multimodal chat request...', JSON.stringify(requestBody));

        if (systemPrompt) {
            requestBody.systemInstruction = { parts: [{ text: systemPrompt }] };
        }

        console.debug('Canvas AI: [AntigravityTools] Sending multimodal chat request...');

        const requestParams: RequestUrlParam = {
            url: endpoint,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        };

        try {
            const response = await requestUrl(requestParams);
            const data = response.json as GeminiResponse;
            console.debug('Canvas AI: [AntigravityTools] Raw Response:', JSON.stringify(data));
            return this.extractTextAndThinkingFromResponse(data);
        } catch (error: unknown) {
            this.handleError(error);
        }
    }

    /**
     * Extract text and thinking from response
     */
    private extractTextAndThinkingFromResponse(data: GeminiResponse): { content: string; thinking?: string; thoughtSignature?: string } {
        const candidates = data.candidates;
        if (!candidates || candidates.length === 0) {
            throw new Error('AntigravityTools returned no candidates');
        }

        const parts = candidates[0]?.content?.parts;
        if (!parts || parts.length === 0) {
            throw new Error('AntigravityTools returned no parts in response');
        }

        // Separate thinking and output parts
        const thinkingParts = parts.filter((p: GeminiPart) => p.text && p.thought);
        const outputParts = parts.filter((p: GeminiPart) => p.text && !p.thought);
        
        const textPart = outputParts.length > 0
            ? outputParts[outputParts.length - 1]
            : parts.find((p: GeminiPart) => p.text);

        if (!textPart?.text) {
            throw new Error('AntigravityTools returned no text in response');
        }

        const thinking = thinkingParts.map(p => p.text).join('');
        // Extract thought signatures
        // According to docs, we might get signatures on thinking parts or text parts
        const thoughtSignature = parts.find(p => p.thoughtSignature)?.thoughtSignature;

        console.debug(`Canvas AI: [AntigravityTools] Received response (thinking: ${thinking.length > 0 ? 'yes' : 'no'}, signature: ${thoughtSignature ? 'yes' : 'no'})`);
        
        return {
            content: textPart.text,
            thinking: thinking || undefined,
            thoughtSignature
        };
    }

    /**
     * Legacy wrapper - extract text only
     */
    private extractTextFromResponse(data: GeminiResponse): string {
        return this.extractTextAndThinkingFromResponse(data).content;
    }

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

            console.debug('Canvas AI: Fetched image, mimeType:', mimeType, 'size:', arrayBuffer.byteLength);
            return `data:${mimeType};base64,${base64Data}`;
        } catch (error: unknown) {
            throw new Error(`Failed to fetch image: ${getErrorMessage(error)}`);
        }
    }

    private handleError(error: unknown): never {
        if (isHttpError(error)) {
            const errorBody = error.json || { message: error.message };
            const errorMessage = (errorBody as Record<string, Record<string, string>>).error?.message || error.message;
            console.error('Canvas AI: AntigravityTools HTTP Error', error.status, errorBody);
            throw new Error(`HTTP ${error.status}: ${errorMessage}`);
        }
        throw error;
    }

    /**
     * Chat completion with streaming
     */
    async *streamChatCompletion(
        prompt: string | GeminiContent[],
        systemPrompt?: string,
        temperature: number = 1.0,
        thinkingConfig?: { enabled: boolean; budgetTokens?: number; level?: 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH' }
    ): AsyncGenerator<{ content?: string; thinking?: string; thoughtSignature?: string }, void, unknown> {
        const model = this.getTextModel();
        // Replace :generateContent with :streamGenerateContent and add alt=sse
        let endpoint = this.getGeminiEndpoint(model);
        endpoint = endpoint.replace(':generateContent', ':streamGenerateContent');
        endpoint += '&alt=sse';

        let contents: GeminiContent[] = [];

        if (typeof prompt === 'string') {
            contents = [{ role: 'user', parts: [{ text: prompt }] }];
        } else {
            contents = prompt;
        }

        const requestBody: GeminiRequest = {
            contents: contents,
            generationConfig: { temperature: temperature }
        };

        // Add thinking config if enabled
        if (thinkingConfig?.enabled) {
            const genConfig = requestBody.generationConfig!;
            genConfig.thinkingConfig = {
                includeThoughts: true
            };
            if (thinkingConfig.level) {
                genConfig.thinkingConfig.thinkingLevel = thinkingConfig.level;
            } else {
                genConfig.thinkingConfig.thinkingBudget = thinkingConfig.budgetTokens || 8192;
            }
            console.debug('Canvas AI: [AntigravityTools] Thinking enabled:', JSON.stringify(genConfig.thinkingConfig));
        }

        if (systemPrompt) {
            requestBody.systemInstruction = { parts: [{ text: systemPrompt }] };
        }

        console.debug('Canvas AI: [AntigravityTools] Sending stream chat request...');

        try {
            const response = await globalThis.fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`AntigravityTools API Error: ${response.status} ${errorText}`);
            }

            if (!response.body) {
                throw new Error('Response body is null');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                buffer += chunk;
                const lines = buffer.split('\n');
                
                buffer = lines.pop() || ''; 

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    
                    if (trimmed.startsWith('data: ')) {
                        try {
                            const dataStr = trimmed.slice(6);
                            const data = JSON.parse(dataStr) as GeminiResponse;
                            
                            if (data.candidates && data.candidates.length > 0) {
                                const parts = data.candidates[0].content?.parts;
                                if (parts) {
                                    for (const part of parts) {
                                        // Debug: 输出完整 part
                                        console.debug('Canvas AI: [AntigravityTools] Stream part:', JSON.stringify(part));
                                        if (part.text) {
                                            // Gemini 的 thought 标记
                                            if (part.thought) {
                                                // yield 原始 thinking 文本
                                                yield { thinking: part.text };
                                            } else {
                                                yield { content: part.text };
                                            }
                                        }
                                        
                                        // Capture thought signature
                                        if (part.thoughtSignature) {
                                            yield { thoughtSignature: part.thoughtSignature };
                                        }
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
            console.error('Canvas AI: AntigravityTools Stream Error', error);
            throw error;
        }
    }
}

