# Obsidian Canvas AI Plugin

在 Obsidian Canvas 中集成 Gemini AI，选中节点（文本、图片、群组）作为上下文进行 AI 对话/生成，结果回写到画布。Canvas 是 .json 格式。

## 语言
- 使用中文回答和代码注释

## 规则
- 使用 Context7 MCP 检索 API 文档
- 改动后运行 `npm run build` 和 `npm run lint`
- 精简注释，这是一个纯vibe-coding项目，不需要过多注释

## 文件大小限制 (Vibe Coding 友好)
- **单文件上限**: 800 行
- **建议拆分**: 超过 500 行时考虑模块化
- **核心原则**: 每个文件只做一件事

> ⚠️ 文件过大会降低 AI 辅助编码效率，请及时拆分

## 目录结构
```
src/
├── settings/      # 设置相关
├── ui/            # UI 组件 (FloatingPalette, Modals)
├── canvas/        # Canvas 功能 (转换、意图解析、节点操作)
├── api/           # API 管理
├── prompts/       # 默认 Prompt 模板
├── utils/         # 工具函数 (调试等)
└── types.ts       # 类型定义
main.ts            # 插件入口
```


## 多语言 (i18n)
- `lang/locale/en.json` 为主 (Source of Truth)，`zh-cn.json` 为翻译
- 使用 `t('key')` 函数调用，支持参数插值 `t('Hello {name}', { name: 'World' })`
- UI 文本用 Sentence case（仅首字母大写）

## 文档
- 设计文档: `docs/design_doc.md`
- 审核规范: `docs/audit-checklist.md` (提交 PR 前检查)
