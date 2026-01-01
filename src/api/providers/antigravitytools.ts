/**
 * AntigravityTools Provider
 * 文字生成使用 Gemini 原生 API，图片生成使用 OpenAI 兼容 API
 */

import { requestUrl, RequestUrlParam } from 'obsidian';
import type { CanvasAISettings } from '../../settings/settings';
import type { GeminiRequest, GeminiResponse, GeminiPart } from '../types';
import { isHttpError, getErrorMessage, requestUrlWithTimeout } from '../utils';

// OpenAI Images API 响应格式
interface OpenAIImageResponse {
    created: number;
    data: Array<{
        b64_json?: string;
        url?: string;
        revised_prompt?: string;
    }>;
    error?: { message: string };
}

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

    /**
     * 将 aspectRatio 转换为 OpenAI size 格式
     */
    private aspectRatioToSize(aspectRatio?: string): string {
        switch (aspectRatio) {
            case '16:9': return '1792x1024';
            case '9:16': return '1024x1792';
            case '4:3': return '1024x768';
            case '3:4': return '768x1024';
            case '1:1':
            default: return '1024x1024';
        }
    }

    /**
     * Chat completion - 使用 Gemini 原生格式
     */
    async chatCompletion(prompt: string, systemPrompt?: string, temperature: number = 0.5): Promise<string> {
        const model = this.getTextModel();
        const endpoint = this.getGeminiEndpoint(model);

        const parts: Array<{ text: string }> = [];
        parts.push({ text: prompt });

        const requestBody: GeminiRequest = {
            contents: [{ role: 'user', parts: parts }],
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
     * Generate image - 使用 OpenAI 兼容 /v1/images/generations
     */
    async generateImage(
        instruction: string,
        imagesWithRoles: { base64: string, mimeType: string, role: string }[],
        contextText?: string,
        aspectRatio?: string,
        _resolution?: string
    ): Promise<string> {
        const endpoint = this.getImageEndpoint();

        // 构建 prompt
        let fullPrompt = '';

        // 系统上下文
        const systemPrompt = this.settings.imageSystemPrompt || '';
        if (systemPrompt) {
            fullPrompt += systemPrompt + '\n\n';
        }

        // 添加参考图片描述（OpenAI generations 不支持直接传图，需要描述）
        // 注意：如果有参考图片，通常需要用 /v1/images/edits 端点
        if (imagesWithRoles.length > 0) {
            fullPrompt += '[Reference images provided - ';
            fullPrompt += imagesWithRoles.map(img => img.role).join(', ');
            fullPrompt += ']\n\n';
        }

        // 添加上下文文本
        if (contextText && contextText.trim()) {
            fullPrompt += contextText + '\n\n';
        }

        // 添加指令
        fullPrompt += instruction;

        // 构建请求体 - 遵循 OpenAI API 格式
        const requestBody: {
            model: string;
            prompt: string;
            n: number;
            size: string;
            response_format: string;
            quality?: string;
            style?: string;
        } = {
            model: this.getImageModel(),
            prompt: fullPrompt,
            n: 1,
            size: this.aspectRatioToSize(aspectRatio),
            response_format: 'b64_json'
        };

        console.debug('Canvas AI: [AntigravityTools] Sending image generation request to:', endpoint);
        console.debug('Canvas AI: [AntigravityTools] Request body:', JSON.stringify(requestBody, null, 2));

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
            console.debug(`Canvas AI: Image generation timeout set to ${timeoutMs / 1000}s`);
            const response = await requestUrlWithTimeout(requestParams, timeoutMs);
            const data = response.json as OpenAIImageResponse;

            console.debug('Canvas AI: [AntigravityTools] Response:', JSON.stringify(data, null, 2).substring(0, 500));

            if (data.error) {
                throw new Error(`AntigravityTools API Error: ${data.error.message}`);
            }

            if (!data.data || data.data.length === 0) {
                throw new Error('AntigravityTools returned no image data');
            }

            const imageData = data.data[0];
            if (imageData.b64_json) {
                return `data:image/png;base64,${imageData.b64_json}`;
            } else if (imageData.url) {
                // URL 可能是 data URL 或需要 fetch
                if (imageData.url.startsWith('data:')) {
                    return imageData.url;
                }
                return await this.fetchImageAsDataUrl(imageData.url);
            }

            throw new Error('No valid image data in response');
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
     * Multimodal chat - 使用 Gemini 原生格式
     */
    async multimodalChat(
        prompt: string,
        mediaList: { base64: string, mimeType: string, type: 'image' | 'pdf' }[],
        systemPrompt?: string,
        temperature: number = 0.5
    ): Promise<string> {
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
            return this.extractTextFromResponse(data);
        } catch (error: unknown) {
            this.handleError(error);
        }
    }

    private extractTextFromResponse(data: GeminiResponse): string {
        const candidates = data.candidates;
        if (!candidates || candidates.length === 0) {
            throw new Error('AntigravityTools returned no candidates');
        }

        const parts = candidates[0]?.content?.parts;
        if (!parts || parts.length === 0) {
            throw new Error('AntigravityTools returned no parts in response');
        }

        // 过滤思考部分
        const outputParts = parts.filter((p: GeminiPart) => p.text && !p.thought);
        const textPart = outputParts.length > 0
            ? outputParts[outputParts.length - 1]
            : parts.find((p: GeminiPart) => p.text);

        if (!textPart?.text) {
            throw new Error('AntigravityTools returned no text in response');
        }

        console.debug('Canvas AI: [AntigravityTools] Received response (filtered thinking)');
        return textPart.text;
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
}
