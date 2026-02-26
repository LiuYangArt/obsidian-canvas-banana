# Obsidian Canvas AI Plugin

在 Obsidian 中提供 Canvas + Notes 一体化 AI 能力：支持选区上下文对话、文本改写、节点生成、图片生成，并可接入多 Provider（Gemini / OpenRouter / GptGod 等）。

## 语言
- 使用中文回答、分析与任务清单
- 代码注释保持精简，优先解释“为什么”，使用英文注释。

## 规则
- 开始任何任务前，先查看 `.codebase_index.md` 了解仓库结构，再按需精读目标文件
- 使用 Context7 MCP 检索 API 文档
- 改动后运行 `npm run build` 和 `npm run lint`
- 保持最小可审阅改动，避免无关重构

## 文件大小限制 (Vibe Coding 友好)
- **增量约束**: 新增文件或大规模重构时，目标不超过 800 行
- **建议拆分**: 超过 500 行时优先考虑模块化
- **历史兼容**: 对已超过 800 行的历史文件，优先局部修改；若持续增长，需补充拆分计划
- **核心原则**: 每个文件尽量只做一件事

> ⚠️ 文件过大会降低 AI 辅助编码效率，应优先控制新增复杂度

## 目录结构
```
src/
├── api/           # API 管理与 Provider 适配
├── canvas/        # Canvas 功能 (转换、意图解析、节点操作)
├── core/          # 核心管理器 (如 ghost node)
├── notes/         # Notes AI 相关能力
├── prompts/       # 默认 Prompt 模板
├── settings/      # 设置相关
├── ui/            # UI 组件 (FloatingPalette, Modals)
├── utils/         # 工具函数
└── types.ts       # 类型定义
main.ts            # 插件入口
lang/              # 多语言资源
docs/              # 设计与实现文档
```

## 多语言 (i18n)
- `lang/locale/en.json` 为主 (Source of Truth)，`zh-cn.json` 为翻译
- 使用 `t('key')` 函数调用，支持参数插值 `t('Hello {name}', { name: 'World' })`
- UI 文本用 Sentence case（仅首字母大写）

## 文档
- 代码库索引: `.codebase_index.md`（开始任务前优先阅读）
- 审核规范: `docs/audit-checklist.md`（提交 PR 前检查）
- 已实现功能索引: `docs/implementedfeatures.md`（实现新功能前必看）
