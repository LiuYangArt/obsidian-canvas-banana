# Canvas Banana (Obsidian Plugin)

Canvas Banana 是一个专为 Obsidian Canvas（白板）视图打造的 AI 增强插件。它深度集成了 Gemini 等先进 AI 模型，让你可以在白板中直接进行智能对话、文本创作和图像生成。

该插件的核心理念是"节点感知"——它能理解你选中的白板节点内容（文本、卡片、图片），并以此为上下文协助你的创作。

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

*   **⚡ 高效的工作流**
    *   **多任务并发**：支持“发射后不管”，你可以同时发起多个生成任务，无需等待上一个完成。
    *   **提示词预设 (Prompt Presets)**：内置预设管理功能，支持保存、重命名和快速调用常用的提示词。

*   **🌍 多 API 支持**
    *   **OpenRouter**: 支持接入广泛的模型库。
    *   **Yunwu (云雾)**: 深度优化的多模态体验。
    *   支持自定义模型 ID。

## ⚠️ 免责声明 (Disclaimer)

使用本插件即代表您同意以下条款：

1.  **第三方服务**：本插件的功能实现依赖于第三方 API 服务（如 OpenRouter AI 或 Yunwu AI）。插件作者与这些服务提供商无直接关联。
2.  **费用自理**：调用 AI 模型可能产生 API 使用费用，该费用由 API 服务商收取，请用户自行在对应平台充值和管理。
3.  **内容合规**：用户应确保使用生成的内容符合当地法律法规及 OpenAI/Google 等模型提供商的使用政策。插件作者不对用户生成的内容承担法律责任。
4.  **隐私安全**：您的 API Key 仅保存在本地 Obsidian 配置中，插件不会将其上传至除此之外的任何服务器。但请注意，对话内容会被发送至第三方 API 此外进行处理。

## 📥 安装指南 (手动安装)

由于本插件目前可能处于测试阶段或未上架社区商店，请按照以下步骤手动安装：

1.  **插件下载**
    *   [https://github.com/LiuYangArt/obsidian-canvas-banana/blob/main/Plugin/canvas-banana.zip](https://github.com/LiuYangArt/obsidian-canvas-banana/blob/main/Plugin/canvas-banana.zip)

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
2.  选择 **API Provider** (默认 OpenRouter)。
3.  填入你的 **API Key**。
4.  (可选) 选择或自定义你偏好的 Text/Image 模型。

### 2. 唤起操作面板
1.  打开一个 **Canvas (白板)** 文件。
2.  使用鼠标框选或点击选中一个或多个节点。
3.  在节点上方自动弹出的原生菜单条中，点击 **香蕉图标 (🍌)**。
4.  **Canvas Banana** 悬浮面板将会出现在选中框的右侧。

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
