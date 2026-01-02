[简体中文](#zh-cn) | [English](#en-us)

[https://www.youtube.com/watch?v=FN8d_2q4evo](https://www.youtube.com/watch?v=FN8d_2q4evo)

<span id="zh-cn"></span>

# Canvas Banana (Obsidian Plugin)

Canvas Banana 是一个专为 Obsidian Canvas（白板）视图打造的 AI 增强插件。它深度集成了 Gemini 等先进 AI 模型，让你可以在白板中直接进行智能对话、文本创作和图像生成。

该插件的核心理念是"节点感知"——它能理解你选中的白板节点内容（文本、卡片、图片），并以此为上下文协助你的创作。

<br><img width="2200" height="1185" alt="image" src="https://github.com/user-attachments/assets/94bfc72e-6823-42da-8f3a-2c9da7bb77b8" />



## 🌟 核心功能

*   **🤖 上下文感知对话 (Chat)**
    *   智能识别选中的 Canvas 节点内容作为对话背景。
    *   在白板中直接与 AI 探讨想法、总结内容或扩展思路。
    *   支持调节 "Temperature" 以控制回答的创造性。

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
    *   **智能悬浮编辑**: 选中笔记文本即可唤起 AI 进行润色、翻译或改写。
    *   **侧边栏副驾驶 (Sidebar Co-pilot)**: 类似 Google Gemini Canvas 的侧边栏体验，支持多轮对话和全文级修改建议。
    *   **Diff 视图审阅**: AI 的修改建议会以 Diff 形式呈现，确认后才应用，拒绝"吃字"，确保数据安全。
    *   **笔记内生图**: 支持在 Markdown 笔记中直接生成图片，支持“图生图”参考。

*   **⚡ 增强的 Canvas 编辑**
    *   **节点级原位编辑**: 直接在 Canvas 节点内部选中文字进行 AI 修改，AI 会同时参考连线节点的上下文。
    *   **文件节点支持**: 支持直接编辑 Canvas 中引用的 .md 文件节点。

*   **🌍 多 API 支持**
    *   目前支持gemini/openrouter/yunwu
      
## ⚠️ 免责声明 (Disclaimer)

使用本插件即代表您同意以下条款：

1.  **第三方服务**：本插件的功能实现依赖于第三方 API 服务（如 OpenRouter AI 或 Yunwu AI）。插件作者与这些服务提供商无直接关联。
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
*   **悬浮编辑**: 在笔记中选中文本，点击浮现的 🍌 图标，即可快速进行 AI 编辑或生图。
*   **侧边栏副驾驶 (Sidebar Co-pilot)**: 点击 Obsidian 右侧边栏的 🍌 图标打开 Side Panel。
    *   **Edit**: 全文级修改建议，支持 Diff 审阅。
    *   **Image**: 文档内生图。
    *   **Chat**: 纯对话模式，基于文档上下文进行问答而不修改文档。
*   **Diff 确认**: AI 的修改建议会弹出一个 Diff 对比窗口，你可以清晰地看到变化，点击 "Confirm" 才会应用修改。


## 📄 License (开源协议)

This project is licensed under the GNU General Public License v3.0 - see the [LICENSE](LICENSE) file for details.

本项目采用 GNU General Public License v3.0 开源协议，详情请参阅 [LICENSE](LICENSE) 文件。

---

<span id="en-us"></span>
# Canvas Banana (Obsidian Plugin)

**Canvas Banana** is an AI enhancement plugin designed specificially for the **Obsidian Canvas** view. It deeply integrates advanced AI models (like Gemini, OpenRouter), allowing you to conduct intelligent conversations, content generation, and image creation directly within your whiteboard.

The core philosophy of this plugin is "**Node Awareness**"—it understands the context of the nodes you select (text, cards, images) and uses them as context to assist your creative process.

<br><img width="2200" height="1185" alt="image" src="https://github.com/user-attachments/assets/94bfc72e-6823-42da-8f3a-2c9da7bb77b8" />


## 🌟 Core Features

*   **🤖 Context-Aware Chat**
    *   Intelligently recognizes selected Canvas node content as conversation context.
    *   Discuss ideas, summarize content, or brainstorm with AI directly on the canvas.
    *   Supports "Temperature" adjustment to control the creativity of responses.

*   **🎨 AI Image Generation**
    *   Transforms text descriptions into high-quality images.
    *   Offers rich **Aspect Ratio** options: 1:1, 16:9, 4:3, 9:16, etc.
    *   Supports multiple **Resolutions**: 1K, 2K, 4K.
    *   Capable of using selected node text as the prompt for image generation.

*   **🧠 Canvas Node Generation**
    *   Let the LLM answer your questions in the form of a mind map or interconnected nodes.

*   **⚡ Efficient Workflow**
    *   **Concurrency**: Supports "fire and forget"—initiate multiple generation tasks simultaneously without waiting.
    *   **Prompt Presets**: Built-in preset management to save, rename, and quickly reuse common prompts.

*   **📝 Note AI Assistant** [NEW]
    *   **Smart Floating Edit**: Select text in your notes to trigger AI for polishing, translation, or rewriting.
    *   **Sidebar Co-pilot**: A sidebar experience similar to Google Gemini Canvas, supporting multi-turn conversations and global edit suggestions.
    *   **Diff Review**: AI changes are presented as Diffs; apply them only after confirmation to ensure data safety.
    *   **In-Note Image Gen**: Generate images directly within Markdown notes, with support for Image-to-Image references.

*   **⚡ Enhanced Canvas Editing**
    *   **In-Place Node Edit**: Edit text *inside* a Canvas node with AI, which understands the context from connected nodes.
    *   **File Node Support**: Directly edit .md file nodes referenced in the Canvas.

*   **🌍 Multi-API Support**
    *   Currently supports Gemini, OpenRouter, and Yunwu.

## ⚠️ Disclaimer

By using this plugin, you agree to the following terms:

1.  **Third-Party Services**: This plugin relies on third-party API services (e.g., OpenRouter AI, Yunwu AI, Google Gemini). The plugin author is not directly affiliated with these providers.
2.  **Costs**: Calling AI models may incur API usage fees charged by the service provider. Please manage your billing on the respective platforms.
3.  **Content Compliance**: Users are responsible for ensuring generated content complies with local laws and the policies of model providers. The author assumes no liability for user-generated content.
4.  **Privacy**: Your API Key is stored locally in your Obsidian config and is not uploaded to any server by the plugin. However, conversation content is sent to the third-party API for processing.

## 📥 Installation Guide (Manual)

Since this plugin may be in beta or not yet in the community store, please follow these steps:

1.  **Download the Plugin**
    *   Get latest version in [releases](https://github.com/LiuYangArt/obsidian-canvas-banana/releases).

2.  **Create Plugin Folder**
    *   Open your Obsidian vault directory.
    *   Navigate to `.obsidian/plugins/`.
    *   Extract the zip package there.<br><img width="803" height="573" alt="image" src="https://github.com/user-attachments/assets/e2d07451-3d49-41b5-888e-484d853cb22e" />

3.  **Enable the Plugin**
    *   Restart Obsidian.
    *   Go to **Settings** -> **Community Plugins**.
    *   Turn off "Restricted Mode".
    *   Find "Canvas Banana" in the list and toggle it on.
    <br><img width="1601" height="157" alt="image" src="https://github.com/user-attachments/assets/b07f3f52-61bc-454d-90c7-c531fe129f73" />


## 🚀 User Guide

### 1. Configure API Key
Before first use:
1.  Go to **Settings** -> **Canvas Banana**.
2.  Select **API Provider** .
3.  Enter your **API Key**.
4.  (Optional) Select custom models for Text/Image.


### 2. Activate the Panel
1.  Open a **Canvas** file.
2.  Select one or more nodes.
3.  Click the **Banana Icon (🍌)** in the floating menu above the node.<br><img width="297" height="60" alt="image" src="https://github.com/user-attachments/assets/ae552ae8-5ec0-404b-be19-a44292eb0fe4" />
4.  The **Canvas Banana** panel appears.
5.  *Tip*: If you select a text node with an empty prompt box, the node's content is automatically used as the prompt.

### 3. AI Chat (Text Mode)
*   Switch to the **Text** tab.
*   Type your question or instruction.
*   (Optional) Use a **Preset**.
*   Click **Generate**.
*   The output will appear as a new card on the canvas.

### 4. Image Generation (Image Mode)
*   Switch to the **Image** tab.
*   Describe the image (or leave blank to use selected node text).
*   Set **Resolution** and **Ratio**.
*   Click **Generate**.
*   The image appears as a new node.

### 5. Manage Prompt Presets
Use the icons above the input box:
*   **+ (Add)**: Save current text as a preset.
*   **💾 (Save)**: Update the selected preset.
*   **❌ (Delete)**: Remove the selected preset.
*   **📖 (Rename)**: Rename the selected preset.
*   **📌 (Pin)**: Pin the floating panel.

### 6. Note AI Assistant (Note Mode)
The plugin perfectly supports standard Markdown notes in addition to Canvas:
*   **Floating Edit**: Select text in any note and click the floating 🍌 icon to quick start AI editing or image generation.
*   **Sidebar Co-pilot**: Click the 🍌 icon in the right ribbon to open the Side Panel.
    *   **Edit**: Global edit suggestions with Diff review.
    *   **Image**: Generate images inside the document.
    *   **Chat**: Pure conversation mode to chat with your document context without modifying it.
*   **Diff Confirmation**: AI modification suggestions appear in a Diff comparison window. You can clearly see the changes and click "Confirm" to apply them.
