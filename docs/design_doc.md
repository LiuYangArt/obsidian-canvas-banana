Obsidian Canvas AI 助手插件设计文档

1. 产品概述

目标：在 Obsidian Canvas 视图中集成 Gemini AI，允许用户选中画布中的节点（文本、图片、群组）作为上下文，进行 AI 对话、文本生成或图像生成，并将结果无缝回写到画布中。

2. 交互与界面设计 (UI/UX)

2.1 核心交互：多功能悬浮面板 (The Floating Palette)

为了提供类似 Photoshop 插件的高效体验，我们放弃简单的模态框，设计一个功能丰富的 "悬浮面板"。

触发方式：选中 Canvas 节点后，点击 "AI Sparkles ✨" 按钮，面板在鼠标附近弹出。

布局参考：顶部 Tab 切换模式，中间为输入区与预设，底部为参数与生成按钮。

界面区域划分：

A. 顶部模式栏 (Mode Switcher)

[ 💬 Chat / Text ]: 用于总结、翻译、润色、代码解释（对应场景 2）。

[ 🎨 Generate Image ]: 用于文生图、图生图、多图组合生图（对应场景 1）。

B. 预设与输入区 (Presets & Prompt)

Prompt Presets (下拉菜单):

显示 "Select a preset..."。

右侧跟随小按钮组：[Save] (保存当前输入为预设), [Manage] (打开设置页)。

交互：选择预设后，自动填充下方的文本框，用户可继续修改。

Prompt Input (多行文本框):

支持多行输入。

Placeholder 随模式变化（如："Describe the image..." 或 "Ask a question about selected notes..."）。

C. 参数控制区 (Settings Bar) - 仅在 "Generate Image" 模式显示

Aspect Ratio (比例): 提供图标按钮组 [1:1] [16:9] [4:3] [9:16]。

注：Gemini Image API 通常需要通过 Prompt 描述宽高比，或者后续 API 更新支持参数。我们可以在 Prompt 后自动追加 "in 16:9 aspect ratio" 等后缀。

Style (风格): 可选下拉 [None], [Photorealistic], [Anime], [Sketch].

D. 底部操作栏 (Action Footer)

Context Preview: 左下角小字显示 "🔗 3 Nodes Selected (1 Image, 2 Text)"。

[ Generate ] 按钮: 全宽主按钮，点击开始异步任务。

2.2 任务反馈与结果 (Async Feedback)

加载状态: 点击 Generate 后，面板自动收起，在 Canvas 上生成 "Ghost Node"（加载占位符），显示呼吸灯动画和 "Generating..."。

结果回写:

Chat 模式: 生成 Text Node。

Image 模式: 生成 File Node (图片)。

错误处理 (Error Handling):

如果任务失败（如 API 报错、网络超时、Safety Filter 拦截），Ghost Node 变为 Error Node（红色边框 + ⚠️ 图标）。

交互：点击 Error Node，弹出 Toast 显示具体错误信息（如 "Safety filter triggered"），并提供 [Retry] 按钮重新提交任务。

3. 技术实现方案 (Technical Architecture)

3.1 难点一：上下文获取与本地预处理

同前文，利用 CanvasConverter 将选中的节点转换为 Markdown 或 Mermaid，并将图片转换为 Base64。

3.2 难点二：多任务异步处理

同前文，使用 TaskQueue 管理。

3.3 难点三：结果回写

同前文，文本存 Node，图片存 Vault 文件。

3.4 难点四：特定场景的高级实现 (New Use Cases)

针对您提出的两个特定场景，我们需要设计专门的处理管线 (Pipeline)。

场景 1：多图组合生图 (Image Combination / Remix)

用户行为：选中 3 张参考图（如：一张构图、一张配色、一张主体），输入 Prompt "Combine these into a cyberpunk city"。

技术挑战：需要模型同时理解多张输入图片的视觉特征，并根据 Prompt 生成新图。
解决方案：利用 Gemini 3 Pro Image (gemini-3-pro-image-preview) 的原生多模态输入能力。

Direct Image Input (单步生成)

该模型支持直接接受 image (Base64) 和 text 的混合输入。

Input: 构造一个包含 text (用户 Prompt) 和多个 inline_data (选中的图片 Base64) 的 Payload。

Model Behavior: Gemini 3 会“看”这些图片，理解其构图、风格或内容，然后直接生成符合要求的新图。

优势: 速度快，保留原图细节能力更强，Token 消耗比“转译法”更直观。

场景 2：图文混合总结 (Multimodal Summarization)

用户行为：选中 Canvas 上的一堆乱七八糟的节点（截图、笔记、PDF 片段），输入 "整理成一份简报"。

技术实现：

Payload 构造:

使用 CanvasConverter.toMarkdown() 将文本节点整理为结构化文本。

将图片节点提取为 Base64。

构造 Gemini 1.5 Pro 的 contents 数组，交替放入 text (Markdown) 和 inline_data (Images)。

System Prompt: "You are a helpful assistant. The user has provided a set of notes and images from a whiteboard canvas. Please summarize them into a coherent report."

3.5 难点五：智能布局与节点定位 (Layout Algorithm)

为了防止新生成的节点遮挡现有内容，需要实现简单的避让算法。

计算包围盒 (Bounding Box):

遍历所有选中节点，计算整体的 minX, minY, maxX, maxY。

定位策略:

默认位置: x = maxX + 50 (右侧 50px), y = minY (顶部对齐)。

尺寸预设:

Text Node: 宽度固定 400px，高度自适应。

Image Node: 默认 500x500px (后续根据图片比例调整)。

碰撞检测 (可选优化):

检查默认位置是否已有其他节点。如果有，则向下偏移 y += 50 直到找到空位，或向更右侧偏移。

4. API 参考与配置

4.1 Obsidian Plugin API

(保持不变)

4.2 Gemini / OpenRouter API Payload 设计

A. 生图 Payload (Gemini 3 Pro Image - 多模态输入)

现在我们可以直接发送 Base64 图片给生图模型：

{
  "model": "google/gemini-3-pro-image-preview",
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "Generate a cyberpunk city based on these reference images. --aspect 16:9"
        },
        {
          "type": "image_url",
          "image_url": {
            "url": "data:image/png;base64,iVBORw0KGgo..." // 图片 1 Base64
          }
        },
        {
          "type": "image_url",
          "image_url": {
            "url": "data:image/png;base64,abcde1234..." // 图片 2 Base64
          }
        }
      ]
    }
  ]
}


注意：具体的 JSON 字段名（image_url vs inline_data）取决于您使用的是 OpenRouter 标准接口还是 Google 原生接口。上例为 OpenRouter/OpenAI 兼容格式，Google 原生格式使用 parts: [{ inline_data: {...} }]。

5. 插件设置与配置管理 (Settings)

5.1 API Provider 配置

允许用户添加、存储和切换多个 API 服务商。

数据结构 (Interface):

interface ApiProvider {
    id: string;
    name: string;        
    providerType: 'gemini' | 'openai' | 'custom';
    baseUrl: string;
    apiKey: string;
    modelName: string;   
    isDefault: boolean;
    safetySettings?: string; // e.g., "BLOCK_NONE" (针对 Gemini)
}


5.2 Prompt Preset Manager

(保持不变)

5.3 通用设置 (General Settings)

Image Output Path (图片存放路径):

选项: Root (根目录), Current Folder (当前 Canvas 所在文件夹), Attachment Folder (Obsidian 设置的附件文件夹), Custom (自定义路径)。

默认值: Attachment Folder。

Default System Prompt:

用于 Chat 模式的默认系统提示词。

示例: "You are an expert researcher embedded in a knowledge graph tool. Answer concisely and use Markdown formatting."

6. 开发路线图建议

Phase 1 (Core & UI): 搭建悬浮面板 UI (React/Svelte 推荐)，实现基本的 Chat 模式。

Phase 2 (Settings): 完成 Provider、Preset 以及 Path Settings 管理。

Phase 3 (Image Pipeline): 实现 CanvasImageHelper 读取本地图片转 Base64，并对接 Gemini 3 生图接口。

Phase 4 (Canvas Integration): 完善 Node Placement 算法，处理文件保存与错误反馈。