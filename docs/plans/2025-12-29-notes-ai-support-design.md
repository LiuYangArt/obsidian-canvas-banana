# Obsidian Canvas AI - Notes 编辑支持设计 (Optimized)

## 概述

为 Obsidian Markdown notes 添加原生 AI 编辑支持，深度集成 Google Gemini 能力。不仅提供类似 Google Gemini Canvas 的交互体验，更针对长文档编辑进行增强，解决上下文丢失与全局一致性问题。

## 核心需求 & 解决方案

1.  **选中文字 AI 编辑 (Contextual Edit)**
    *   **需求**: 悬浮工具条，支持“修改/替换/润色”。
    *   **增强**:
        *   **上下文感知**: 自动判断是否需要全文作为 Context (例如“根据前文重写这段总结”)。
        *   **全局一致性 (Entity Consistency)**: 当 AI 检测到修改了实体（如人名 "Adam" -> "David"），自动扫描全文并提议批量修改。

2.  **全文 AI 协作 (Co-pilot)**
    *   **需求**: 侧边栏对话框，支持多轮对话。
    *   **防丢失策略 (No-Loss Guarantee)**: 避免 Google Canvas 长文“吃字”问题。
        *   **方案**: 采用 **Diff-based Generation**。AI 不返回全文，而是返回“修改补丁” (JSON Patches 或 Search/Replace Blocks)。即使拥有 1M Context，也禁止 AI 重写未修改的段落。

3.  **多模态支持**
    *   **图片生成**: 复用 Canvas 生图能力。生成的图片自动转为 WebP 并插入文档，同时作为后续对话的多模态上下文。

4.  **独立预设系统**
    *   **需求**: Notes 与 Canvas 的 Prompt Presets 分离。
    *   **实现**: 独立的 `notes-presets.json` 存储，支持独立的 System Prompt 设置（如设定为“专业编辑”角色）。

## 交互流程设计

### 1. 悬浮编辑 (Floating Edit)

*   **触发**: 选中文字 -> 悬浮 "AI Sparkle" 图标 -> 点击展开面板。
*   **面板 UI**: 复用 FloatingPalette，但精简为 Notes 模式。
    *   [输入框]: 支持 `/` 呼出 Presets。
    *   [Context Toggle]: 🔘 Include Full Doc (默认根据 Prompt 智能开启，也可手动开关)。
    *   **UX 优化 (2025-12-31)**:
        *   **选区清理**: 面板关闭或生成结束时，自动清除高亮。
        *   **交互锁定**: 生成过程中，悬浮按钮显示绿色呼吸态且不可点击。
        *   **状态持久化**: 生成过程中切换侧栏 (Focus Change) 不会隐藏悬浮按钮。
*   **Diff 预览**:
    *   AI 生成后，不直接替换。
    *   弹出一个 **Diff Popover** (类似 Git Diff)，显示 `Last Name: Adam -> David`。
    *   用户点击 `[Confirm]` 后应用。

### 2. 全局实体更新 (The "Ripple Effect") - 优化方案

> **2025-12-31 优化**: 原多步 AI 调用方案已重构为**一次性处理**，大幅提升用户体验。

*   **场景**: 用户选中 "Adam is the main character..." 并改为 "David is..."。
*   **优化后流程** (单次 AI 调用):
    1.  发送全文上下文 + 选区 + 用户指令给 AI
    2.  AI 返回 JSON: `{ replacement: "选区修改", globalChanges: [其他位置的修改] }`
    3.  DiffModal 预览选区修改
    4.  用户确认后，同时应用选区修改和所有全局变更
*   **AI Prompt 格式** (`src/prompts/edit-mode-prompt.ts`):
    ```json
    {
      "replacement": "David is the main character...",
      "globalChanges": [
        { "original": "Adam said hello", "new": "David said hello" },
        { "original": "Adam's house", "new": "David's house" }
      ]
    }
    ```
*   **优点**:
    *   单次 API 调用，无延迟
    *   代码简洁，删除了 `global-update.ts`
    *   用户体验流畅

### 3. Note 侧边栏 (Note Sidebar)

*   **入口 (Entry)**:
    *   在 Obsidian 右侧 Ribbon 增加一个 **"香蕉" (Banana) 图标按钮** 🍌 (与 Obsidian 其他侧栏按钮并列)。
    *   点击用于切换本插件 Side Panel 的显示/隐藏。

*   **界面布局 (Layout)**:
    *   **总体风格**: 视觉上深度参考 **Google Gemini Canvas** 的侧栏设计。
    *   **Body (Chat History)**:
        *   **显示内容**: 用户的 Prompt + AI 的回复。
        *   **AI 回复约束**: 仅显示**总结性文字** (如 "已为您补充了完整的世界观文档...")。
        *   **关键点**: 
            *   ❌ **不要**显示 AI 的思考过程 (Thought)。
            *   ❌ **不要**显示具体的修改信息 (Diffs)。
            *   ✅ 保持界面清爽，专注于“对话流”。
    *   **Footer (Input Area)**:
        *   **组件复用**: 直接复用当前 Edit Mode (悬浮条) 的输入框组件。
        *   **功能**: 支持 Model 选择、Prompt Presets 呼出等现有功能。

*   **对话上下文管理 (Context Management)**:
    *   **问题**: 长文档 + 多轮对话容易导致 Token 爆炸。
    *   **策略**:
        *   **限制对话轮数**: 默认保留最近 **N 轮对话** (建议 N=5，可配置)。
        *   **滑动窗口**: 超过 N 轮后，自动丢弃最早的对话。
        *   **文档上下文**: 每次请求发送**完整当前文档**，但对话历史受限。
    *   **配置项**: `notesSettings.maxConversationTurns: number` (默认 5)。

*   **AI Summary 生成方案**:
    *   **目标**: AI 返回修改后，侧栏仅显示简洁总结，不显示具体 Diff。
    *   **实现方案 (扩展现有 Prompt)**:
        1.  **扩展 JSON 格式**: AI 返回 `{ replacement, globalChanges, summary }` 格式。
            *   复用现有 `edit-mode-prompt.ts`，增加 `summary` 字段。
            *   `summary`: 一句话描述做了什么修改 (如 "将主角名从 Adam 改为 David，并更新了全文 3 处引用")。
        2.  **前端显示**: 侧栏直接渲染 `summary` 字段内容，隐藏 `globalChanges` 细节。
        3.  **修改应用**: 复用现有 `applyPatches()` 逻辑 (`src/notes/text-patcher.ts`)。
        *   单次 API 调用，无额外延迟。
        *   用户可在 DiffModal 中查看详细修改，侧栏保持清爽。
        *   **交互优化**: 若用户在 DiffModal 中点击取消，侧栏最后一条 AI 消息会自动更新为 "User rejected changes"，避免误导。

*   **其他优化点**:
    *   **📌 导出对话**: 可选功能，将对话历史导出为 Markdown 文件。
    *   ✅ **文档切换感知**: 当用户切换到不同 Note 时，自动清空对话历史 (避免上下文混淆)。
    *   **📌 Streaming 响应**: 支持流式输出，提升大文档编辑时的响应体验。

## 架构设计


### 核心组件

```
┌─────────────────────────────────────────────────────────┐
│                    main.ts (Plugin)                      │
├─────────────────────────────────────────────────────────┤
│  Canvas Mode                │  Notes Mode (New)          │
│  ├── CanvasFloatingPalette  │  ├── NoteFloatingPalette   │
│  └── ...                    │  ├── DiffReviewModal       │
│                             │  ├── SideBarCoPilotView    │
│                             │  └── NoteContextManager    │
├─────────────────────────────────────────────────────────┤
│                  Shared Core                             │
│  ├── ApiManager (Gemini Protocol)                        │
│  ├── PresetManager (Split into Canvas/Notes inputs)      │
│  └── ImageProcessor (WebP conversion)                    │
└─────────────────────────────────────────────────────────┘
```

### 数据结构：独立预设 (Independent Presets)

在 `data.json` 中扩展：

```typescript
interface PluginSettings {
  // Existing
  canvasPresets: PromptPreset[];
  
  // New
  notesSettings: {
    systemPrompt: string; // e.g. "You are an expert editor..."
    triggerDelay: number; // 200ms
    presets: PromptPreset[]; // 独立的 Notes 预设
    enableGlobalConsistency: boolean; // 是否开启全局实体检测
  }
}
```

### 关键技术实现

#### 1. Diff-based Text Replacement (防丢失核心)

AI 的 Prompt 将被设计为返回**操作指令**而非全文：

**System Prompt 示例**:
> You are a text editor agent. Do NOT rewrite the full text.
> If the user asks to modify text, output a JSON list of changes:
> `[{"original": "exact original sentence", "new": "modified sentence"}]`
> or use Search/Replace blocks.

**TypeScript 处理**:
```typescript
interface TextChange {
  original: string; // 用于定位
  new: string;      // 用于替换
  similarity?: number; // 模糊匹配容错
}

function applyPatches(docContent: string, patches: TextChange[]) {
  // 遍历 patch，使用精确匹配或模糊匹配定位并替换
  // 确保文档其他部分 100% 完整
}
```

#### 2. 图片上下文处理

*   **读取**: 解析当前 Note 中的 `![[image.png]]` 链接。
*   **处理**: 读取 Vault 文件 -> 压缩为 WebP (512x512 或原分辨率) -> Base64。
*   **发送**: 构造多模态 Message `parts: [{text: ...}, {inline_data: ...}]`。

## 实施路线图

> **2025-12-30 更新**: Canvas 项目中已完成以下组件，可直接复用。

### ✅ 可复用的 Canvas 组件

| 组件 | 位置 | 备注 |
|------|------|------|
| **DiffModal** | `src/ui/modals.ts` | Diff 预览 UI，支持 Before/After 高亮 |
| **Edit Mode JSON 格式** | `src/prompts/edit-mode.ts` | AI 返回 `{"replacement": "..."}` 格式 |
| **内嵌图片解析** | `src/canvas/intent-resolver.ts` | `extractEmbeddedImages()` + `resolveImagePath()` |
| **图片压缩** | `src/canvas/canvas-converter.ts` | `readSingleImageFile()` + `compressImageToWebP()` |
| **ApiManager** | `src/api/api-manager.ts` | 多 Provider 支持 + multimodal 调用 |
| **PresetManager** | `main.ts` + Settings | 已支持按 Mode 分离预设 |
| **FloatingPalette** | `src/ui/floating-palette.ts` | 可适配为 Notes 版本 |

### Phase 1: 基础编辑器集成 ✅
- [x] 实现 `NoteFloatingPalette` (复用 FloatingPalette UI)。→ **`src/notes/notes-edit-palette.ts`**
- [x] 实现 `NoteContextManager` (获取选区 + 可选的全文)。→ **`src/notes/notes-selection-handler.ts`**
- [x] ~~实现基础的 "Replace Selection" 功能。~~ → **复用 DiffModal + Edit Mode**
- [x] **Notes 图片上下文支持**: 解析 `![[image.png]]` 并发送多模态请求。→ **`extractDocumentImages()` in notes-selection-handler.ts**

### Phase 2: 预设与侧边栏
- [x] ~~分离 Preset 系统 (Canvas vs Notes)。~~ → **架构已就绪，需扩展 settings**
- [x] 开发 `SideBarCoPilotView`。
- [x] ~~实现 "Rexview Changes" 弹窗 (Diff View)。~~ → **DiffModal 可直接使用**

### Phase 3: 高级智能 (Smart Features)
- [x] **Global Update Implementation**: ~~原两阶段 Prompt 方案~~ → **优化为一次性处理，集成到 Edit Mode Prompt 中**
    - AI 返回 `{ replacement, globalChanges }` 格式
    - 通过 `applyPatches()` 应用全局变更
    - 删除了 `src/notes/global-update.ts`
- [x] ~~**Note Image Support**: 解析 markdown 图片引用并传入 LLM。~~ → **`extractEmbeddedImages()` 已完成**

### Phase 4: 稳定性与优化
- [x] **Diff Algorithm**: 完善 `applyPatches` 逻辑，处理 AI 返回的 "original" 文本与实际文本存在细微差异的情况 (Fuzzy matching)。→ **`src/notes/text-patcher.ts`**
- [ ] 性能测试：处理 10k+ 字长文档。

### Phase 5: 代码优化 (2025-12-31)
- [x] **formatProviderName 提取**: 将 4 个文件中的重复函数提取为共享工具函数 → `src/utils/format-utils.ts`
- [x] **侧栏图片上下文支持**: `sidebar-copilot-view.ts` 添加 `extractDocumentImages` + `multimodalChat`，与悬浮编辑功能对齐
- [x] **移除清除对话按钮**: 设计简化，文档切换时自动清空对话历史即可满足需求

