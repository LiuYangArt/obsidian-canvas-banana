# 已实现功能索引

> 开发前先查阅，避免重复实现

## API 层 (`src/api/`)

| 文件 | 功能 | 关键方法 |
|-----|------|---------|
| `api-manager.ts` | 统一 API 入口 | `chatCompletion`, `streamChatCompletion`, `multimodalChat`, `generateImageWithRoles` |
| `providers/gemini.ts` | Gemini 原生 API | 图片生成、多模态 |
| `providers/openrouter.ts` | OpenRouter 代理 | 兼容 OpenAI 格式 |
| `providers/gptgod.ts` | GPTGod 代理 | 兼容 OpenAI 格式 |
| `providers/antigravitytools.ts` | AntigravityTools | Gemini 文字 / OpenAI 兼容图片 / Thought Signatures |
| `types.ts` | 类型定义 | `GeminiContent`, `GeminiPart` (含 thoughtSignature) |

## Canvas 功能 (`src/canvas/`)

| 文件 | 功能 |
|-----|------|
| `intent-resolver.ts` | 意图解析 (Text/Image/Node/Edit 模式) |
| `canvas-converter.ts` | 节点→Markdown/Mermaid 转换、图片压缩 |
| `node-operations.ts` | 创建群组、选择连接节点、新建节点 |
| `node-mode-utils.ts` | JSON 提取/验证、坐标重映射、布局优化 |
| `image-viewer.ts` | 新窗口打开图片、复制到剪贴板 |
| `ghost-node.ts` | Ghost Node 节点操作 (创建/更新/高度自适应) |
| `utilities.ts` | Canvas 工具函数 |

## Notes 功能 (`src/notes/`)

| 文件 | 功能 |
|-----|------|
| `notes-selection-handler.ts` | 文本选中监听、Edit/Image 状态中央同步控制、Edit 模式流式生成 (Thinking)、配置全屏同步 |
| `notes-edit-palette.ts` | Notes 悬浮面板 (Edit/Image 双 Tab)、Thinking 配置与实时同步 |
| `sidebar-copilot-view.ts` | side CoPilot (Chat/Edit/Image)、Thinking 流式显示与自动折叠、配置全屏同步 |
| `note-image-task-manager.ts` | 图片生成任务队列、并发控制 |
| `text-patcher.ts` | 文本 patch 应用 |
| `mode-controller.ts` | 面板模式切换控制器 (Edit/Image/Text) |
| `notes-floating-button.ts` | 悬浮香蕉按钮逻辑 |
| `shared-ui-builder.ts` | Notes 通用 UI 组件构建器 (Tab/Preset/Image/ThinkingOptions) |

## UI 组件 (`src/ui/`)

| 文件 | 功能 |
|-----|------|
| `floating-palette.ts` | Canvas 浮动面板 (Text/Image/Node/Edit 四模式)、Thinking 配置全组件同步 |
| `modals.ts` | DiffModal (diff 对比确认)、InputModal、ConfirmModal |
| `preset-manager.ts` | Preset 下拉管理器 |

## 核心模块 (`src/core/`)

| 文件 | 功能 |
|-----|------|
| `ghost-node-manager.ts` | Ghost Node 生命周期、替换为图片/Canvas 结构 |

## 工具类 (`src/utils/`)

| 文件 | 功能 |
|-----|------|
| `debug.ts` | 调试输出 |
| `format-utils.ts` | `formatProviderName()` |
| `image-utils.ts` | `extractDocumentImages()`, `saveImageToVault()` |

## 设置 (`src/settings/`)

| 文件 | 功能 |
|-----|------|
| `settings.ts` | 类型定义、DEFAULT_SETTINGS |
| `settings-tab.ts` | 设置页面 UI |

## i18n (`lang/`)

- `helpers.ts`: `t()` 函数
- `locale/en.json`: 英文 (Source of Truth)
- `locale/zh-cn.json`: 中文翻译

## Prompts (`src/prompts/`)

| 文件 | 功能 |
|-----|------|
| `node-mode-prompt.ts` | Node 模式系统提示 |
| `edit-mode-prompt.ts` | Edit 模式系统提示 |
