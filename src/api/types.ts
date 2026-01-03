/**
 * API 类型定义
 * 包含 OpenRouter、Gemini、GptGod 等 Provider 的类型
 */

// ========== Error Type ==========

export interface HttpError {
    status: number;
    message: string;
    json?: Record<string, unknown>;
}

// ========== OpenRouter Types ==========

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

export interface OpenRouterStreamChunk {
    id: string;
    model: string;
    choices: Array<{
        delta: {
            content?: string;
            role?: string;
        };
        finish_reason: string | null;
    }>;
}

// ========== GptGod Types ==========

export type GptGodResponse = OpenRouterResponse & {
    images?: string[];
    image?: string;
    data?: Record<string, unknown>; // Allow flexible data field for GPTGod
};

// ========== Gemini Types ==========

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
        thinkingConfig?: {
            includeThoughts?: boolean;
            thinkingBudget?: number;
            thinkingLevel?: 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH';
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
