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

**最终结果**: 4768 行 → 2360 行 (**减少 50.5%**)

---

## 代码清理

- [x] 删除未使用的 temperature 变量和方法
- [ ] 合并重复的 Provider switch-case 模式（可选）
- [ ] 将 debugSelectedNodes 移入可选调试模块（可选）

---

## 验证清单

- [x] `npm run build` 通过
- [x] `npm run lint` 通过
- [ ] 手动验证插件功能
- [ ] 验证四种模式（Text/Image/Node/Edit）
- [ ] 验证预设管理功能
