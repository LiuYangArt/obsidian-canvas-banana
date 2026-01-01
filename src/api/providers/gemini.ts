/**
 * Gemini Provider
 * 处理 Gemini 和 Yunwu 的原生 API 调用
 */

import { requestUrl, RequestUrlParam } from 'obsidian';
import type { CanvasAISettings } from '../../settings/settings';
import type { GeminiRequest, GeminiResponse, GeminiPart } from '../types';
import { isHttpError, getErrorMessage, requestUrlWithTimeout } from '../utils';

export class GeminiProvider {
    private settings: CanvasAISettings;
    private isYunwu: boolean;

    constructor(settings: CanvasAISettings, isYunwu: boolean = false) {
        this.settings = settings;
        this.isYunwu = isYunwu;
    }

    updateSettings(settings: CanvasAISettings): void {
        this.settings = settings;
    }

    private get providerName(): string {
        return this.isYunwu ? 'yunwu' : 'gemini';
    }

    getApiKey(): string {
        return this.isYunwu
            ? (this.settings.yunwuApiKey || '')
            : (this.settings.geminiApiKey || '');
    }

    getTextModel(): string {
        return this.isYunwu
            ? (this.settings.yunwuTextModel || 'gemini-2.0-flash')
            : (this.settings.geminiTextModel || 'gemini-2.5-flash');
    }

    getImageModel(): string {
        return this.isYunwu
            ? (this.settings.yunwuImageModel || 'gemini-3-pro-image-preview')
            : (this.settings.geminiImageModel || 'gemini-2.5-flash-preview-05-20');
    }

    private getBaseUrl(): string {
        return this.isYunwu
            ? (this.settings.yunwuBaseUrl || 'https://yunwu.ai')
            : (this.settings.geminiBaseUrl || 'https://generativelanguage.googleapis.com');
    }

    private getEndpoint(model: string): string {
        const baseUrl = this.getBaseUrl();
        const apiKey = this.getApiKey();
        return `${baseUrl}/v1beta/models/${model}:generateContent?key=${apiKey}`;
    }

    /**
     * Chat completion
     */
    async chatCompletion(prompt: string, systemPrompt?: string, temperature: number = 0.5): Promise<string> {
        const model = this.getTextModel();
        const endpoint = this.getEndpoint(model);

        const parts: Array<{ text: string }> = [];
        parts.push({ text: prompt });

        const requestBody: GeminiRequest = {
            contents: [{ role: 'user', parts: parts }],
            generationConfig: { temperature: temperature }
        };

        if (systemPrompt) {
            requestBody.systemInstruction = { parts: [{ text: systemPrompt }] };
        }

        console.debug(`Canvas AI: [${this.providerName}] Sending chat request...`);

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
     * Generate image
     */
    async generateImage(
        instruction: string,
        imagesWithRoles: { base64: string, mimeType: string, role: string }[],
        contextText?: string,
        aspectRatio?: string,
        resolution?: string
    ): Promise<string> {
        const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];

        // System context
        parts.push({
            text: this.settings.imageSystemPrompt || 'You are an expert creator. Use the following references.'
        });

        // Add images with role annotations
        for (const img of imagesWithRoles) {
            const mime = img.mimeType || 'image/png';
            parts.push({ text: `\n[Ref: ${img.role}]` });
            parts.push({ inlineData: { mimeType: mime, data: img.base64 } });
        }

        // Add context text
        if (contextText && contextText.trim()) {
            parts.push({ text: `\n[Context]\n${contextText}` });
        }

        // Add instruction
        parts.push({ text: `\nINSTRUCTION: ${instruction}` });

        const requestBody: GeminiRequest = {
            contents: [{ role: 'user', parts: parts }],
            generationConfig: { responseModalities: ['image'] }
        };

        // Add image config
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

        console.debug(`Canvas AI: [${this.providerName}] Sending image generation request...`);

        const model = this.getImageModel();
        const endpoint = this.getEndpoint(model);

        const requestParams: RequestUrlParam = {
            url: endpoint,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        };

        try {
            const timeoutMs = (this.settings.imageGenerationTimeout || 120) * 1000;
            console.debug(`Canvas AI: Image generation timeout set to ${timeoutMs / 1000}s`);
            const response = await requestUrlWithTimeout(requestParams, timeoutMs);
            const data = response.json as GeminiResponse;

            return this.parseGeminiImageResponse(data);
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
     * Multimodal chat
     */
    async multimodalChat(
        prompt: string,
        mediaList: { base64: string, mimeType: string, type: 'image' | 'pdf' }[],
        systemPrompt?: string,
        temperature: number = 0.5
    ): Promise<string> {
        const model = this.getTextModel();
        const endpoint = this.getEndpoint(model);

        const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];

        // Add text prompt first
        parts.push({ text: prompt });

        // Add images and PDFs as inlineData
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

        console.debug(`Canvas AI: [${this.providerName}] Sending multimodal chat request...`);

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
            throw new Error('Gemini returned no candidates');
        }

        const parts = candidates[0]?.content?.parts;
        if (!parts || parts.length === 0) {
            throw new Error('Gemini returned no parts in response');
        }

        // Filter out thinking parts
        const outputParts = parts.filter((p: GeminiPart) => p.text && !p.thought);
        const textPart = outputParts.length > 0
            ? outputParts[outputParts.length - 1]
            : parts.find((p: GeminiPart) => p.text);

        if (!textPart?.text) {
            throw new Error('Gemini returned no text in response');
        }

        console.debug(`Canvas AI: [${this.providerName}] Received response (filtered thinking)`);
        return textPart.text;
    }

    private async parseGeminiImageResponse(data: GeminiResponse): Promise<string> {
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

        // No image found
        const outputParts = parts.filter((p: GeminiPart) => p.text && !p.thought);
        const textPart = outputParts.length > 0
            ? outputParts[outputParts.length - 1]
            : parts.find((p: GeminiPart) => p.text);
        const textContent = textPart?.text || 'No image returned';
        throw new Error(`Image generation failed: ${textContent}`);
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
            console.error(`Canvas AI: ${this.providerName} HTTP Error`, error.status, errorBody);
            throw new Error(`HTTP ${error.status}: ${errorMessage}`);
        }
        throw error;
    }
}
