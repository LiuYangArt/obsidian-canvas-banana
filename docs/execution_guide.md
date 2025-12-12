Obsidian Canvas AI 插件分步执行指南 (Execution Guide)

本指南旨在通过“小步快跑”的方式，逐步构建复杂的 AI 插件。每一阶段完成后，请务必进行验证测试。

阶段 1：骨架搭建与 UI 原型 (Skeleton & UI)

目标：创建一个能跑通的空插件，实现设置页面和悬浮面板的 UI 交互，暂不涉及任何 AI 逻辑。

步骤 1.1：初始化与设置页面

操作：

使用 obsidian-plugin-sample 初始化项目。

安装 react 和 react-dom (建议 UI 部分用 React 开发以提高效率)。

创建 SettingsTab.ts。

实现 API Provider 管理界面（静态列表即可，支持添加/删除 UI 交互，数据存入 data.json）。

关键代码点：

Plugin.loadData() 和 Plugin.saveData()。

测试 (Checklist)：

[x] 启用插件不报错。

[x] 打开设置页，能看到 Provider 列表。

[ ] 点击“添加 Provider”，能输入 Name/Key 并保存到本地数据。

步骤 1.2：Canvas 悬浮面板 (Floating Palette)

操作：

监听 Obsidian 的 canvas:selection-menu 事件（或通过 workspace.on('layout-change') 轮询 Canvas 选中状态）。

当检测到 Canvas 有节点被选中时，在 DOM 中注入一个自定义的 React 组件（悬浮球/面板）。

实现面板的 UI 布局：Tabs (Chat/Image), Input Textarea, Generate Button。

关键代码点：

document.body.appendChild() 挂载 React Root。

计算选中节点的 Bounding Box，将悬浮面板定位在节点附近。

测试 (Checklist)：

[x] 在 Canvas 中选中一个节点。

[x] "AI Sparkles ✨" 按钮出现在选中框旁边。

[x] 点击按钮，弹出悬浮面板，可以输入文字，点击按钮有反应（console.log 即可）。

阶段 2：Canvas 数据读取与转换 (Data Extraction)

目标：让插件“看懂”用户选了什么。

步骤 2.1：获取选中节点数据

操作：

通过 workspace.getActiveViewOfType(ItemView) 获取当前 Canvas View。

访问 canvas.selection 获取选中节点对象。

测试 (Checklist)：

[x] 选中 1 个文本节点 + 1 个图片节点。

[x] 控制台打印出这 2 个节点的 ID、Text 内容和 File 路径。

步骤 2.2：实现 Converter 工具类 (核心)

操作：

创建 CanvasConverter.ts。

实现 toMarkdown()：将选中节点转为 Markdown 文本（处理层级）。

实现 toMermaid()：将选中节点转为 Mermaid 流程图代码。

暂不处理图片 Base64，图片仅返回 ![[filename]] 引用文本。

测试 (Checklist)：

[x] 选中一组有连线的节点。

[x] 在悬浮面板点击一个“Debug”按钮，控制台输出清晰的 Markdown/Mermaid 字符串。

[x] 确认输出的结构符合逻辑（父子关系、连线关系正确）。

阶段 3：API 对接与异步任务管理 (Logic & API)

目标：打通与 LLM 的通信管道。

步骤 3.1：API Manager 与请求发送

操作：

创建 ApiManager.ts。

实现 fetchOpenRouter 或 fetchGemini 方法。

在悬浮面板点击 "Generate" 时，调用 API，传入固定的测试 Prompt（如 "Say Hello"）。

测试 (Checklist)：

[x] 填入真实的 API Key。

[x] 点击生成，控制台能打印出 LLM 返回的 JSON 数据。

步骤 3.2：任务队列与 Ghost Node (UI 反馈)

操作：

点击 "Generate" 后，立即在 Canvas 上创建一个 "占位节点" (Ghost Node)。

节点内容显示 "AI Generating..." 动画。

将 taskId 与这个 Node ID 绑定。

测试 (Checklist)：

[x] 点击生成，UI 面板收起。

[x] Canvas 上出现一个新的卡片，显示加载中。

[x] API 返回后，控制台打印完成，Ghost Node 内容变为 AI 响应结果。

阶段 4：文本生成闭环 (Text Pipeline)

目标：完成 选中 -> 转换 Context -> 发送 LLM -> 写入 Canvas 的完整流程。

步骤 4.1：整合 Context 与 API

操作：

将 步骤 2.2 的 Converter 输出作为 Prompt 的一部分 (system prompt 或 user context)。

将悬浮面板的用户输入作为 user instruction。

发送给 LLM。

测试 (Checklist)：

[x] 选中 Canvas 上的笔记。

[x] 输入 "总结这段内容"。

[x] Ghost Node 成功变为 AI 生成的总结文本。

步骤 4.2：智能排版 (避让算法)

操作：

优化 createNode 的坐标逻辑。

计算选中区域的 maxX，将新节点放在 maxX + 50 处。

测试 (Checklist)：

[x] 无论选中哪里的节点，生成的回答都不会遮挡住原有的内容。

阶段 5：图像处理与多模态 (Image Pipeline)

目标：实现图片读取（输入）和图片保存（输出）。

步骤 5.1：读取图片 (Vision Input)

操作：

扩展 CanvasConverter。

使用 app.vault.readBinary() 读取选中图片文件。

转换为 Base64 字符串。

修改 API Payload，构造 Gemini 3 所需的多模态格式。

测试 (Checklist)：

[x] 选中一张图片。

[x] 输入 "图片里有什么？"。

[x] 文本节点返回准确的图片描述。

步骤 5.2：生成图片与保存 (Image Output)

操作：

对接 Gemini 3 Pro Image API (生图)。

解析 API 返回的 Base64 图片数据。

将 Base64 转为 Buffer。

使用 app.vault.createBinary() 保存为 .png 文件（存放到附件目录）。

在 Canvas 上创建 file 类型的节点，指向该图片。

测试 (Checklist)：

[ ] 切换到 "Generate Image" 模式。

[ ] 输入 "A cute cat"。

[ ] 稍等片刻，Canvas 上出现了一张新的猫猫图片节点。

[ ] 检查 Vault 文件夹，确认图片文件真实存在。

阶段 6：完善与发布 (Polish)

目标：提升稳定性和用户体验。

步骤 6.1：预设管理 (Prompt Presets)

操作：

在设置页实现预设的增删改查。

在悬浮面板实现预设的下拉选择与填充。

6.2：错误处理与日志

操作：

捕获 API 错误（401, 429, 500）。

将 Ghost Node 样式变为红色边框，并显示简短错误信息。

6.3：发布准备

操作：

清理 console.log。

编写 README 和 manifest.json。

使用 npm run build 打包。