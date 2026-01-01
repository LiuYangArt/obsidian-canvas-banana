OpenAI API Provider 集成
为 Canvas AI 插件添加标准 OpenAI API provider，支持现有的文字编辑、文生图、图生图功能。

背景信息
根据用户截图，目标后端（Antigravity-Manager）已支持 OpenAI 兼容 API：

base_url: http://127.0.0.1:8045/v1
API Key 格式: sk-xxx
OpenAI API 核心端点：

Chat Completions: POST /v1/chat/completions - 文字生成/编辑
Images Generation: POST /v1/images/generations - 文生图
Images Edit: POST /v1/images/edits - 图片编辑（需 multipart/form-data）
User Review Required
IMPORTANT

图片编辑 API 格式差异：OpenAI /v1/images/edits 使用 multipart/form-data 格式（需要上传文件），与当前 
generateImage
 接口的 JSON body + base64 格式不兼容。

建议方案：对于图生图场景，复用 /v1/chat/completions + 多模态输入（类似 AntigravityTools 的 
generateImageWithChat
），而非使用 /v1/images/edits。

NOTE

新增 Provider 标识：将使用 openai 作为新的 
ApiProvider
 类型值。

Proposed Changes
Settings Module
[MODIFY] 
settings.ts
添加 OpenAI provider 设置字段：

-export type ApiProvider = 'openrouter' | 'yunwu' | 'gemini' | 'gptgod' | 'antigravitytools';
+export type ApiProvider = 'openrouter' | 'yunwu' | 'gemini' | 'gptgod' | 'antigravitytools' | 'openai';
 export interface CanvasAISettings {
+    // OpenAI settings
+    openaiApiKey: string;
+    openaiBaseUrl: string;
+    openaiTextModel: string;
+    openaiImageModel: string;
+    openaiUseCustomTextModel: boolean;
+    openaiUseCustomImageModel: boolean;
 }
 export const DEFAULT_SETTINGS: CanvasAISettings = {
+    openaiApiKey: '',
+    openaiBaseUrl: 'https://api.openai.com',
+    openaiTextModel: 'gpt-4o',
+    openaiImageModel: 'gpt-image-1',
+    openaiUseCustomTextModel: false,
+    openaiUseCustomImageModel: false,
 };
更新 
getModelByProvider
 和 
setModelByProvider
 函数。

API Types
[MODIFY] 
types.ts
添加 OpenAI 特定类型（复用现有 
OpenRouterMessage
 等类型即可）：

// ========== OpenAI Types (扩展) ==========
export interface OpenAIImageResponse {
    created: number;
    data: Array<{
        b64_json?: string;
        url?: string;
        revised_prompt?: string;
    }>;
    error?: { message: string };
}
export interface OpenAIChatResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: Array<{
        index: number;
        message: {
            role: string;
            content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
        };
        finish_reason: string;
    }>;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
    error?: { message: string };
}
OpenAI Provider
[NEW] 
openai.ts
创建新的 OpenAI provider，实现与现有 provider 相同的接口：

方法	端点	说明
chatCompletion
/v1/chat/completions	标准 chat API
multimodalChat
/v1/chat/completions	带图像/PDF 的多模态
generateImage
智能选择	纯文本→/v1/images/generations
有参考图→/v1/chat/completions
核心逻辑参考 
antigravitytools.ts
，但使用标准 OpenAI 请求/响应格式。

API Manager
[MODIFY] 
api-manager.ts
+import { OpenAIProvider } from './providers/openai';
 export class ApiManager {
+    private openai: OpenAIProvider;
     constructor(settings: CanvasAISettings) {
+        this.openai = new OpenAIProvider(settings);
     }
     updateSettings(settings: CanvasAISettings): void {
+        this.openai.updateSettings(settings);
     }
     // 在各路由方法添加 case 'openai'
 }
Settings UI
[MODIFY] 
settings-tab.ts
添加 OpenAI provider 选项和配置 UI：

Provider 下拉框添加 "OpenAI" 选项
OpenAI 配置区块：API Key、Base URL、Text Model、Image Model
Verification Plan
Automated Tests
# 1. 编译检查
npm run build
# 2. Lint 检查
npm run lint
Manual Verification
用户需按以下步骤手动测试：

Settings 配置

打开插件设置页面
选择 "OpenAI" provider
输入 API Key（截图中的格式：sk-xxx）
修改 Base URL 为 http://127.0.0.1:8045
确认能保存设置
文字生成测试

在 Canvas 中创建文本节点
使用 Chat 模式发送消息
验证能收到 AI 响应
文生图测试

使用 Image 模式
输入图片描述
验证能生成图片
图生图测试（如后端支持）

选中参考图片节点
使用 Image 模式输入修改指令
验证能基于参考图生成新图