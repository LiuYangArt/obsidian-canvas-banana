# Obsidian Canvas Banana - 系统设计文档

## 1. 产品概述

**Canvas Banana** 是一个专为 Obsidian 设计的 AI 增强插件，旨在深度集成 LLM 能力到知识管理工作流中。它不仅强化了 Canvas（白板）视图的交互，更将 AI 能力扩展到了普通的 Markdown 笔记编辑中。

**核心理念**：
- **节点感知 (Node Awareness)**：理解用户选中的上下文（文本、图片、Canvas 节点）。
- **无缝集成 (Seamless Integration)**：通过悬浮面板、侧边栏等原生化 UI 提供 AI 能力。
- **数据安全 (Data Safety)**：所有修改均需用户通过 Diff 视图确认。

---

## 2. 核心功能模块

### 2.1 Canvas AI (白板增强)
在 Canvas 视图中，用户选中节点后可唤起悬浮面板：
- **Chat Mode**: 基于选中的节点（文本/图片/PDF）进行多轮对话。
- **Image Mode**: 文生图、图,生图。支持多分辨率与比例配置。
- **Node Mode**: 生成思维导图或结构化节点组（利用 Canvas JSON 格式）。
- **Edit Mode**: 原位编辑节点内容。

### 2.2 Notes AI (笔记增强)
在 Markdown 笔记视图中提供 AI 辅助：
- **Floating Edit (悬浮编辑)**: 选中文字后出现香蕉图标，提供快速润色、翻译、改写功能。
- **Sidebar Co-pilot (侧边栏副驾驶)**: 提供类似 IDE 的侧边栏对话体验，支持长文档问答与全文编辑。
- **In-Note Image Gen**: 直接在笔记中生成图片，支持参考选区文字或图片。
- **Diff Review**: AI 的修改建议以 Diff 形式展示，防止误操作。

### 2.3 全局一致性 (Global Consistency)
- 在编辑笔记某一部分时，AI 可感知全文上下文，确保修改内容与全文风格、术语一致。
- 支持同时应用多个分散的修改（Global Patches）。

---

## 3. UI 架构

### 3.1 悬浮面板 (Floating Palette)
- **多模式支持**: Tab 切换 Chat / Image / Node / Edit。
- **智能显隐**: 跟随选区位置，自动避让边界。
- **状态同步**: 与侧边栏共享生成状态与任务队列。

### 3.2 侧边栏视图 (Sidebar View)
- **持久化上下文**: 支持多轮对话历史。
- **双向同步**: 与悬浮面板共享 Prompt 预设、模型配置。
- **选区捕获**: 即使焦点在侧栏，也能捕获编辑器中的选区高亮。

### 3.3 交互组件
- **Preset Manager**: 统一管理 Prompt 预设 (Chat/Image/Edit)。
- **DiffModal**: 文本对比确认窗口，支持 Accept/Reject。
- **Ghost Node**: Canvas 生成过程中的占位符，展示加载状态与错误信息。

---

## 4. 技术架构

### 4.1 目录结构
```
src/
├── api/            # API 管理 (Gemini, OpenRouter, Yunwu, Etc)
├── canvas/         # Canvas 核心逻辑 (转换器, 意图解析, 节点操作)
├── notes/          # Notes 核心逻辑 (选区处理, 侧边栏, 悬浮按钮)
├── ui/             # 通用 UI 组件 (悬浮面板, Modal, Preset)
├── core/           # 核心服务 (Ghost Node)
├── utils/          # 工具函数
├── settings/       # 设置管理
└── prompts/        # System Prompts
```

### 4.2 关键流程

#### 意图解析 (Intent Resolution)
用户输入 Prompt -> `IntentResolver` 分析上下文 -> 提取 Instruction + Context + Images -> 路由到对应 Handler。

#### 任务队列 (Task Queue)
- **Canvas**: 异步并发，每个生成任务对应一个 Ghost Node。
- **Notes**: Image 模式支持并发（后台任务），Edit 模式加锁（防止冲突）。

#### 图像处理管线
- **提取**: `extractDocumentImages` 识别 Canvas 节点或 Markdown `![[]]` 图片。
- **转换**: 读取本地文件 -> 压缩/Resize -> Base64。
- **生成**: 调用 API -> 保存到 Vault (Canvas Images 目录) -> 替换/插入节点。

---

## 5. API 集成

系统通过 `ApiManager` 统一管理多 Provider：

| Provider | 特性 | 适用场景 |
|----------|------|----------|
| **Gemini** | 原生多模态, 高速 | 复杂图文理解, 长文本 |
| **OpenRouter** | 聚合模型 (Claude, GPT-4) | 高质量推理, 逻辑分析 |
| **Yunwu / GPTGod** | 中转服务 | 低成本访问 |

---

## 6. 当前状态 (Status)

### 已完成 (Implemented)
- [x] Canvas Chat/Image/Node/Edit 完整功能
- [x] Notes 悬浮编辑与侧边栏 Co-pilot
- [x] 多模态输入支持 (图片/PDF)
- [x] Diff Review 机制
- [x] Ghost Node 异步反馈
- [x] 多 API Provider 设置与切换
- [x] Prompt Preset 管理
- [x] 全局一致性编辑 (Global Patches)

### 待规划 (Future)
- [ ] 更多 Canvas 布局算法优化
- [ ] 本地模型 (Ollama) 支持
- [ ] 语音输入支持