# main.ts 模块拆分重构计划

**创建日期**: 2025-12-30  
**状态**: 进行中

---

## 背景

`main.ts` 文件过长（4768 行），导致 AI 辅助编码效率低下。需按职责拆分为多个模块。

---

## 目录结构

```
src/
├── settings/
│   ├── settings.ts          ✅ 已完成 - 接口 + 默认值
│   └── settings-tab.ts      ⬜ 待拆分 - SettingsTab 类
├── ui/
│   ├── modals.ts            ✅ 已完成 - InputModal, ConfirmModal, DiffModal
│   └── floating-palette.ts  ⬜ 待拆分 - FloatingPalette 类 (~1025 行)
├── canvas/
│   ├── canvas-converter.ts  ✅ 已迁移
│   ├── intent-resolver.ts   ✅ 已迁移
│   ├── node-mode-utils.ts   ✅ 已迁移
│   ├── selection.ts         ⬜ 待拆分 - 选区监听
│   ├── ghost-node.ts        ⬜ 待拆分 - Ghost Node 操作
│   └── utilities.ts         ⬜ 待拆分 - Canvas 工具命令
├── api/
│   └── api-manager.ts       ✅ 已迁移
└── types.ts                 ✅ 已迁移
```

---

## 进度追踪

| 阶段 | 任务 | 状态 | 减少行数 |
|------|------|------|----------|
| 1 | 迁移现有文件到 src/ | ✅ | - |
| 2 | 创建 settings.ts | ✅ | ~165 |
| 3 | 创建 modals.ts | ✅ | ~172 |
| 4 | 创建 floating-palette.ts | ⬜ | ~1025 |
| 5 | 创建 settings-tab.ts | ⬜ | ~1000 |
| 6 | 拆分 Canvas 功能 | ⬜ | ~800 |
| 7 | 代码清理 | ⬜ | ~100 |

**当前进度**: 4768 行 → 4435 行 (-333 行, 7%)

---

## 提交记录

1. `refactor: 迁移模块到 src/ 目录并创建 settings 模块`
2. `refactor: 拆分 Modals 到独立模块`

---

## 验证清单

- [x] `npm run build` 通过
- [x] `npm run lint` 通过
- [ ] 手动验证插件功能
- [ ] 验证四种模式（Text/Image/Node/Edit）
- [ ] 验证预设管理功能
