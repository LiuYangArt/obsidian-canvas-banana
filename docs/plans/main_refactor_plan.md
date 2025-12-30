# main.ts 模块拆分重构计划

**创建日期**: 2025-12-30  
**状态**: ✅ 已完成

---

## 背景

`main.ts` 文件过长（4768 行），导致 AI 辅助编码效率低下。需按职责拆分为多个模块。

---

## 目录结构

```
src/
├── settings/
│   ├── settings.ts          ✅ 接口 + 默认值
│   └── settings-tab.ts      ✅ SettingsTab 类
├── ui/
│   ├── modals.ts            ✅ InputModal, ConfirmModal, DiffModal
│   └── floating-palette.ts  ✅ FloatingPalette 类
├── canvas/
│   ├── canvas-converter.ts  ✅ Canvas 转 AI 格式
│   ├── intent-resolver.ts   ✅ 意图解析
│   ├── node-mode-utils.ts   ✅ Node 模式工具
│   ├── ghost-node.ts        ✅ Ghost Node 操作
│   └── utilities.ts         ✅ Canvas 工具命令
├── api/
│   └── api-manager.ts       ✅ API 管理
├── prompts/
│   ├── index.ts             ✅ Prompts 入口
│   └── node-mode-prompt.ts  ✅ Node Mode 默认 Prompt
├── utils/
│   └── debug.ts             ✅ 调试工具
└── types.ts                 ✅ 类型定义
```

---

## 完成情况

| 阶段 | 任务 | 状态 | 减少行数 |
|------|------|------|----------|
| 1 | 迁移现有文件到 src/ | ✅ | - |
| 2 | 创建 settings.ts | ✅ | ~165 |
| 3 | 创建 modals.ts | ✅ | ~172 |
| 4 | 创建 floating-palette.ts | ✅ | ~1030 |
| 5 | 创建 settings-tab.ts | ✅ | ~1000 |
| 6 | 创建 Canvas 功能模块 | ✅ | - |
| 7 | 代码清理 (temperature) | ✅ | ~30 |
| 8 | 提取 debugSelectedNodes | ✅ | ~197 |
| 9 | 删除未使用 Provider 方法 | ✅ | ~76 |
| 10 | 提取 prompts 到独立模块 | ✅ | ~86 |
| 11 | 清理冗余注释 | ✅ | ~12 |
| 12 | 优化 System Prompt (Chat->Text, Add Edit) | ✅ | - |

**最终结果**: 4768 行 → **1986 行** (**减少 58.3%**)

---

## 验证清单

- [x] `npm run build` 通过
- [x] `npm run lint` 通过
- [ ] 手动验证插件功能
- [ ] 验证四种模式（Text/Image/Node/Edit）
- [ ] 验证预设管理功能
