# api-manager.ts 拆分计划

> 目标：将 1302 行的 api-manager.ts 拆分为多个职责单一的模块

## 当前结构分析

| 功能模块 | 行数 | 内容 |
|---------|------|------|
| 类型定义 | ~115 | OpenRouter/Gemini/GptGod 类型 |
| 工具函数 | ~30 | `isHttpError`, `getErrorMessage`, `requestUrlWithTimeout` |
| Provider 配置 | ~80 | `getActiveProvider`, `getApiKey`, `getChatEndpoint`, etc. |
| **OpenRouter 实现** | ~300 | `chatCompletion`, `generateImage`, `generateImageOpenRouter`, `sendRequest` |
| **Gemini 实现** | ~350 | `chatCompletionGeminiNative`, `generateImageGeminiNative`, `multimodalChatGeminiNative`, `parseGeminiImageResponse` |
| **GptGod 实现** | ~220 | `generateImageGptGod`, `parseGptGodResponse` |
| 通用方法 | ~80 | `generateImageWithRoles`, `multimodalChat` |

---

## 拆分方案

```
src/api/
├── types.ts                 # 类型定义 (~120 行)
├── utils.ts                 # 工具函数 (~40 行)
├── providers/
│   ├── openrouter.ts        # OpenRouter 实现 (~300 行)
│   ├── gemini.ts            # Gemini/Yunwu 实现 (~350 行)
│   └── gptgod.ts            # GptGod 实现 (~220 行)
└── api-manager.ts           # 统一入口 + 路由 (~250 行)
```

---

## 详细文件规划

### 1. `src/api/types.ts` (~120 行)

```typescript
// OpenRouter types
export interface OpenRouterMessage { ... }
export interface OpenRouterRequest { ... }
export interface OpenRouterResponse { ... }

// Gemini types
export interface GeminiPart { ... }
export interface GeminiContent { ... }
export interface GeminiRequest { ... }
export interface GeminiResponse { ... }

// GptGod types
export interface GptGodResponse { ... }

// Shared
export interface HttpError { ... }
```

---

### 2. `src/api/utils.ts` (~40 行)

```typescript
export function isHttpError(error: unknown): error is HttpError
export function getErrorMessage(error: unknown): string
export function requestUrlWithTimeout(params: RequestUrlParam, timeoutMs: number): Promise<RequestUrlResponse>
```

---

### 3. `src/api/providers/openrouter.ts` (~300 行)

```typescript
export class OpenRouterProvider {
    chatCompletion(prompt: string, systemPrompt?: string, temperature?: number): Promise<string>
    generateImage(prompt: string, aspectRatio?: string, imageSize?: string): Promise<string>
    generateImageWithRoles(instruction: string, imagesWithRoles: [...], ...): Promise<string>
    multimodalChat(prompt: string, mediaList: [...], ...): Promise<string>
    private sendRequest(body: OpenRouterRequest): Promise<OpenRouterResponse>
}
```

---

### 4. `src/api/providers/gemini.ts` (~350 行)

```typescript
export class GeminiProvider {
    chatCompletion(prompt: string, systemPrompt?: string, temperature?: number): Promise<string>
    generateImage(instruction: string, imagesWithRoles: [...], ...): Promise<string>
    multimodalChat(prompt: string, mediaList: [...], ...): Promise<string>
    private parseGeminiImageResponse(data: GeminiResponse): Promise<string>
    private fetchImageAsDataUrl(url: string): Promise<string>
}
```

---

### 5. `src/api/providers/gptgod.ts` (~220 行)

```typescript
export class GptGodProvider {
    generateImage(instruction: string, imagesWithRoles: [...], ...): Promise<string>
    private parseGptGodResponse(response: GptGodResponse): Promise<string>
}
```

---

### 6. `src/api/api-manager.ts` (重构后 ~250 行)

```typescript
import { OpenRouterProvider } from './providers/openrouter';
import { GeminiProvider } from './providers/gemini';
import { GptGodProvider } from './providers/gptgod';

export class ApiManager {
    private openrouter: OpenRouterProvider;
    private gemini: GeminiProvider;
    private gptgod: GptGodProvider;

    // 路由到对应 Provider
    chatCompletion(...) { return this.getProvider().chatCompletion(...); }
    generateImage(...) { return this.getProvider().generateImage(...); }
    multimodalChat(...) { return this.getProvider().multimodalChat(...); }
    
    private getProvider(): Provider { ... }
}
```

---

## 拆分顺序

1. ✅ **Phase 1: 类型和工具** - `types.ts`, `utils.ts` (低风险)
2. ✅ **Phase 2: GptGod Provider** - 最简单的 Provider (低风险)
3. ✅ **Phase 3: Gemini Provider** - 被 Gemini 和 Yunwu 共用 (中风险)
4. ✅ **Phase 4: OpenRouter Provider** - 最复杂 (中风险)
5. ✅ **Phase 5: 重构 api-manager.ts** - 改为路由模式 (高风险)

---

## 风险评估

| 模块 | 风险 | 原因 |
|-----|------|-----|
| types.ts | 低 | 纯类型定义，无逻辑 |
| utils.ts | 低 | 纯工具函数 |
| gptgod.ts | 低 | 较独立，逻辑简单 |
| gemini.ts | 中 | 被多处调用 |
| openrouter.ts | 中 | 最多调用点 |
| api-manager 重构 | 高 | 改变调用方式 |

---

## 验证计划

每个 Phase 完成后：
1. `npm run build` 通过
2. `npm run lint` 通过
3. 手动测试 API 调用

---

> [!TIP]
> api-manager 拆分风险低于 main.ts，可优先执行。

---

## 执行总结 (2026-01-01)

**所有 Phase 已完成！**

### 创建的文件

| 文件 | 行数 | 职责 |
|-----|------|-----|
| `src/api/types.ts` | ~115 | 所有 API 类型定义 |
| `src/api/utils.ts` | ~35 | 工具函数 (isHttpError, getErrorMessage, requestUrlWithTimeout) |
| `src/api/providers/gptgod.ts` | ~310 | GptGod Provider |
| `src/api/providers/gemini.ts` | ~320 | Gemini/Yunwu Provider |
| `src/api/providers/openrouter.ts` | ~280 | OpenRouter Provider |

### api-manager.ts 变化

- **原始行数：** 1302 行
- **重构后行数：** ~175 行
- **减少：** ~1127 行 (87%)

### 架构改进

- 从单一大文件拆分为 **6 个职责单一的模块**
- 引入 **Provider 模式**，每个 API 提供商独立封装
- ApiManager 变为纯路由层，简化维护
- 支持 Gemini/Yunwu 共用同一 Provider (通过 isYunwu 标志)
