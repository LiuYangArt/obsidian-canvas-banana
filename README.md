[简体中文](#zh-cn) | [English](#en-us)

[https://www.youtube.com/watch?v=FN8d_2q4evo](https://www.youtube.com/watch?v=FN8d_2q4evo)

<span id="zh-cn"></span>

# Canvas Banana (Obsidian Plugin)

Canvas Banana 是一个原名为 Obsidian Canvas AI 的插件，现在它不仅仅为 Canvas（白板）提供 AI 增强，更是一个全能的 Obsidian AI 助手。它深度集成了 Gemini / OpenAI / Antigravity 等先进 AI 模型，让你可以在 **白板** 和 **笔记** 中无缝进行智能对话、文本创作和图像生成。

该插件的核心理念是"上下文感知"——无论是白板中的节点，还是笔记中的选段，它都能精准理解并以此为背景协助你的创作。

<br><img width="2200" height="1185" alt="image" src="https://github.com/user-attachments/assets/94bfc72e-6823-42da-8f3a-2c9da7bb77b8" />



## 🌟 核心功能

*   **🤖 上下文感知对话 (Chat)**
    *   智能识别选中的 Canvas 节点内容作为对话背景。
    *   在白板中直接与 AI 探讨想法、总结内容或扩展思路。
    *   支持调节 "Temperature" 以控制回答的创造性。
    *   **流式响应 (Streaming)**：支持主流 Provider (Gemini, OpenAI 等) 的流式输出。

*   **🎨 AI 图像生成 (Image Generation)**
    *   将文字描述转化为高质量图片。
    *   提供丰富的 **纵横比 (Ratio)** 选择：1:1, 16:9, 4:3, 9:16 等。
    *   支持多种 **分辨率 (Resolution)**：1K, 2K, 4K。
    *   支持引用选中节点的文本作为图像生成的 Prompt。
 
*   **🎨 canvas 节点生成 (Node Generation)**
*   *   让llm以脑图的形式回答你的问题。

*   **⚡ 高效的工作流**
    *   **多任务并发**：支持“发射后不管”，你可以同时发起多个生成任务，无需等待上一个完成。
    *   **提示词预设 (Prompt Presets)**：内置预设管理功能，支持保存、重命名和快速调用常用的提示词。

*   **📝 笔记 AI 助手 (Note AI Assistant)** [NEW]
    *   **侧边栏副驾驶 (Sidebar Co-pilot)**: 类似 Google Gemini Canvas 的侧边栏体验。
        *   **Chat**: 与当前文档进行多轮对话，支持引用选中内容。
        *   **Edit**: 全文级或段落级修改建议，支持 Diff 视图审阅，确认后才应用。
        *   **Image**: "所见即所得"的文档内生图，支持基于上下文生成配图。
    *   **智能悬浮编辑**: 选中笔记文本即可唤起 AI 进行润色、翻译或改写。支持实时显示 AI **思考过程 (Thinking Process)**。
   
*   **⚡ 增强的 Canvas 编辑**
    *   **节点级原位编辑**: 直接在 Canvas 节点内部选中文字进行 AI 修改，AI 会同时参考连线节点的上下文。
    *   **文件节点支持**: 支持直接编辑 Canvas 中引用的 .md 文件节点。

*   **🌍 多 API 支持**
    *   支持 **Gemini** (Google), **OpenRouter** 等多种 API 提供商。
    *   支持自定义 Base URL 以适配各种 OpenAI 兼容接口。
      
## ⚠️ 免责声明 (Disclaimer)

使用本插件即代表您同意以下条款：

1.  **第三方服务**：本插件的功能实现依赖于第三方 API 服务（如 OpenRouter 等）。插件作者与这些服务提供商无直接关联。
2.  **费用自理**：调用 AI 模型可能产生 API 使用费用，该费用由 API 服务商收取，请用户自行在对应平台充值和管理。
3.  **内容合规**：用户应确保使用生成的内容符合当地法律法规及 OpenAI/Google 等模型提供商的使用政策。插件作者不对用户生成的内容承担法律责任。
4.  **隐私安全**：您的 API Key 仅保存在本地 Obsidian 配置中，插件不会将其上传至除此之外的任何服务器。但请注意，对话内容会被发送至第三方 API 此外进行处理。

## 📥 安装指南 (手动安装)

由于本插件目前可能处于测试阶段或未上架社区商店，请按照以下步骤手动安装：

1.  **插件下载**
    *  在[releases](https://github.com/LiuYangArt/obsidian-canvas-banana/releases)中下载最新版本的插件 zip。

2.  **创建插件文件夹**
    *   打开你的 Obsidian 仓库目录。
    *   进入 `.obsidian/plugins/` 目录。
    *   把zip包解压进去。<br><img width="803" height="573" alt="image" src="https://github.com/user-attachments/assets/e2d07451-3d49-41b5-888e-484d853cb22e" />




3.  **启用插件**
    *   重启 Obsidian。
    *   进入 **设置** -> **第三方插件**。
    *   关闭 "安全模式"（如果尚未关闭）。
    *   在插件列表中找到 "Canvas Banana" 并点击开关启用。
    <br><img width="1601" height="157" alt="image" src="https://github.com/user-attachments/assets/b07f3f52-61bc-454d-90c7-c531fe129f73" />


## 🚀 功能操作指南

### 1. 配置 API Key
首次使用前，请先配置 API：
1.  打开 Obsidian **设置** -> **Canvas Banana**。
2.  选择 **API Provider** 。
3.  填入你的 **API Key**。
4.  (可选) 选择或自定义你偏好的 Text/Image 模型。

- 获得api [yunwu](https://yunwu.ai/register?aff=VE3i) | [gptgod](https://gptgod.site/#/register?invite_code=5ax35dxlk4bys0j7jnzqypwkc)

### 2. 唤起操作面板
1.  打开一个 **Canvas (白板)** 文件。
2.  使用鼠标框选或点击选中一个或多个节点。
3.  在节点上方自动弹出的原生菜单条中，点击 **香蕉图标 (🍌)**。<br><img width="297" height="60" alt="image" src="https://github.com/user-attachments/assets/ae552ae8-5ec0-404b-be19-a44292eb0fe4" />

4.  **Canvas Banana** 悬浮面板将会出现在选中框的右侧。
5.  只选中text node， 且prompt中没有内容时，则把text node本身的内容作为prompt。

### 3. 使用 AI 对话 (Text Mode)
*   切换到 **Text** 标签页。
*   在输入框中输入你的指令或问题。
*   (可选) 选择一个 **Preset** (预设) 快速填入 Prompt。
*   点击 **Generate**。
*   AI 的回复将作为一个新的卡片节点生成在白板上。

### 4. 生成图像 (Image Mode)
*   切换到 **Image** 标签页。
*   在输入框描述你想要的画面（留空则默认使用选中节点的文本）。
*   调整 **Resolution** (分辨率) 和 **Ratio** (比例)。
*   点击 **Generate**。
*   生成的图片将作为图片节点插入到白板中。

### 5. 管理 Prompt 预设
在面板输入框上方有一排工具按钮：
*   **+ (Add)**: 将当前输入框的内容保存为新预设。
*   **💾 (Save)**: 更新当前选中的预设内容。
*   **❌ (Delete)**: 删除当前选中的预设。
*   **📖 (Rename)**: 重命名当前预设。
*   **📌 (Pin)**: 固定悬浮面板（避免自动关闭）。

### 6. 笔记 AI 助手 (Note Mode)
插件不仅支持 Canvas，也完美适配普通 Markdown 笔记编辑：
*   **侧边栏副驾驶 (Sidebar Co-pilot)**: 点击 Obsidian 右侧边栏的 🍌 图标打开 Side Panel。
    *   **Chat**: 纯对话模式，基于文档上下文进行问答。支持 "Insert to cursor" 将 AI 回复插入文档。
    *   **Edit**: 选中一段文本（或不选以针对全文），输入指令。AI 的修改建议会以 Diff 形式呈现，点击 "Confirm" 应用修改。支持 Thinking 模型流式输出。
    *   **Image**: 在文档中生成图片。支持选中一段文字作为 Prompt，或者直接输入描述。
*   **悬浮编辑**: 在笔记中选中文本，点击浮现的 🍌 图标，即可快速唤起悬浮面板进行 AI 编辑或生图。

## 📄 License (开源协议)

本项目采用 GNU General Public License v3.0 开源协议，详情请参阅 [LICENSE](LICENSE) 文件。

---

