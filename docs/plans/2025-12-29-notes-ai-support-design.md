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
*   **Diff 预览**:
    *   AI 生成后，不直接替换。
    *   弹出一个 **Diff Popover** (类似 Git Diff)，显示 `Last Name: Adam -> David`。
    *   用户点击 `[Confirm]` 后应用。

### 2. 全局实体更新 (The "Ripple Effect")

*   **场景**: 用户选中 "Adam is the main character..." 并改为 "David is..."。
*   **后台逻辑**:
    1.  AI 执行修改。
    2.  AI 后台任务 (Chain of Thought): "User changed entity name 'Adam' to 'David'. Check for other occurrences?"
    3.  如果发现其他引用，前端弹出提示: *"Found 15 other references to 'Adam'. Update all?"*
*   **操作**:
    *   点击 `[Update All]` -> AI 生成全局 Patch -> 应用。

### 3. 侧边栏协作 (Sidebar Co-pilot)

*   **界面**: 复用 Obsidian 右侧边栏。
*   **功能**:
    *   **Chat**: 对话历史记录。
    *   **Actions**: "Summarize Doc", "Fix Grammar (Full Text)".
*   **输出**:
    *   对于全文修改，在侧边栏显示 **Changes List** (可交互的修改列表)。
    *   用户可以逐个点击 `[Apply]` 或 `[Apply All]`.

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

### Phase 2: 预设与侧边栏
- [x] ~~分离 Preset 系统 (Canvas vs Notes)。~~ → **架构已就绪，需扩展 settings**
- [ ] 开发 `SideBarCoPilotView`。
- [x] ~~实现 "Review Changes" 弹窗 (Diff View)。~~ → **DiffModal 可直接使用**

### Phase 3: 高级智能 (Smart Features)
- [ ] **Global Update Implementation**: 实现两阶段 Prompt (Modification -> Impact Analysis)。
- [x] ~~**Note Image Support**: 解析 markdown 图片引用并传入 LLM。~~ → **`extractEmbeddedImages()` 已完成**

### Phase 4: 稳定性与优化
- [ ] **Diff Algorithm**: 完善 `applyPatches` 逻辑，处理 AI 返回的 "original" 文本与实际文本存在细微差异的情况 (Fuzzy matching)。
- [ ] 性能测试：处理 10k+ 字长文档。

