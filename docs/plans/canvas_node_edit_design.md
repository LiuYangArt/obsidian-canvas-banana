# Canvas Node In-Place Edit Design

## 1. 核心目标 (Goal)

在 Obsidian Canvas 中，实现针对**选中节点内选中文本**的 AI 原生编辑体验。
完全复用现有的 Context 机制，但在“细粒度”上从“节点级”深入到“文本选区级”。

## 2. 交互流程 (Interaction Flow)

1.  **触发 (Trigger)**:
    *   用户双击进入 Canvas Text Node 编辑模式。
    *   鼠标拖蓝选中一段文字。
    *   点击悬浮菜单 (Floating Palette) 或快捷键触发 AI。
    *   *(注：需检测当前是否在 Canvas 的 Text Node 编辑状态)*

2.  **输入 (Input)**:
    *   弹出/置顶 AI 输入框 (复用现有的 Palette)。
    *   用户输入指令（如 "Make it more professional", "Expand this point"）。
    *   如果留空，则使用默认行为（由 Prompt Preset 决定，如 "润色"）。

3.  **执行 (Execution)**:
    *   系统收集上下文（详情见下文）。
    *   流式请求 AI。
    *   **Text Replacement**: 编辑模式 AI 生成的内容显示 Diff 供确认，取决于 Text Generation 模式。

## 3. 上下文构建 (Context Construction)

核心原则：**Focus + Context + Graph**

### 3.1 Un-selected Context (Focus Node)
对于当前正在编辑的节点（Focus Node）：
*   **Selected Text**: `<target>${selection}</target>` (明确标记这是要修改的部分)。
*   **Preceding Text**: 选区前的文本。
*   **Following Text**: 选区后的文本。
*   *Prompt 策略*: "You are editing the text wrapped in <target> tags. The surrounding text is for context only."

### 3.2 节点连接上下文 (Graph Context)
复用 `IntentResolver` 和 `CanvasConverter` 的既有逻辑，但需针对“编辑模式”微调：

*   **Upstream Nodes (Parents)**: 作为 **Input Context**。
    *   例如：一个 Image 节点连向当前 Text 节点，该图片应作为 Vision Context 传入（参考 Notes Design 的多模态支持，复用 `WebP` 转换逻辑）。
    *   例如：一个 Note 节点连向当前 Text 节点，该 Note 内容应作为背景知识。
*   **Downstream Nodes (Children)**: 作为 **Constraints/Goals** (可选)。
    *   如果当前节点连向另一个 Summary 节点，AI 修改时应保持逻辑连贯，不破坏下游引用（High Priority）。
*   **Group 节点展开**: ✅ (2024-12-31 实现)
    *   当上游/下游遇到 Group 节点时，使用 `canvas.getContainingNodes(bbox)` 获取内部子节点。
    *   提取子节点的文本、图片、.md 文件内容，以 `[GroupLabel]\n内容` 格式组织。

### 3.3 顺序与关系
使用 `IntentResolver.preprocess` 和 `extractEdges` 确保顺序正确：
1.  **DFS/Topological Sort**: 确保上游上下文按逻辑顺序排列。
2.  **Label Context**: 连线上的 Label 也必须包含（如 "Supports", "Refutes"），这对理解上下文关系至关重要。

## 4. 设计协同与增强 (Synergies with Notes Design)

参考 `docs/plans/2025-12-29-notes-ai-support-design.md`，从 Notes AI 设计中汲取以下关键特性以增强 Canvas 体验：

### 4.1 安全替换 (Diff-based Safety) - [x] Implemented
原计划的 "Direct Replacement" 在长文本或复杂修改中风险较高。
*   **采纳方案**: 引入 **Diff Popover** (或简单的 Before/After 预览)。
*   **流程**: AI 生成 -> 解析 JSON Patches -> 弹窗显示 "Diff" -> 用户确认 -> 应用。
*   **System Prompt 增强**: 要求 AI 返回 JSON 格式的修改建议，而非全文直接覆盖，这与 Notes 模式的防丢失策略保持一致。

### 4.2 UI 组件复用 (Unified Floating Palette) - [x] Implemented
*   **目标**: 保持 Notes 和 Canvas Node 编辑体验的一致性。
*   **实现**: 重构 `FloatingPalette` 为通用组件，支持 `mode: 'canvas-chat' | 'canvas-node' | 'note-edit'`。
*   **共享功能**: 预设选择器、Prompt 输入框、Context Toggle 开关。

### 4.3 预设系统对齐 (Aligned Presets) - [x] Implemented
*   **架构**: 扩展 `data.json` 结构，明确区分 `chatPresets`, `imagePresets`, `nodePresets`, 和 `editPresets`。
*   **独立性**: 确保 Edit Mode 拥有独立的 System Prompt 和预设存储，避免与 Node/Chat 模式混淆。
*   **Prompt 组合策略 (Prompt Composition)**:
    *   **User System Prompt**: 用户定义的角色、语言偏好 (如 "Always answer in Chinese")。
    *   **Functional Constraints (Hardcoded)**: 插件强制的格式要求 (Diff/JSON Patch)。
    *   **合并逻辑**: 最终发送给 LLM 的 System Prompt 将是 `User_System_Prompt + "\n\n" + Functional_Constraints`。

## 5. 技术实现方案 (Implementation)

### 5.1 获取编辑器选区 - 关键技术发现 - [x] Implemented

> [!IMPORTANT]
> **Canvas Text Node 使用 IFRAME 而非 CodeMirror！**
> 这是通过实际调试确认的关键发现，原有假设（基于 CodeMirror）是错误的。

**DOM 结构**（编辑模式下）：
```
.canvas-node
  └─ .canvas-node-container
       └─ .canvas-node-content
            └─ <iframe class="embed-iframe is-controlled">
                 └─ #document (contentDocument)
                      └─ 编辑器内容
```

### 5.1 获取编辑器选区 - 关键技术发现 - [x] Implemented

> [!IMPORTANT]
> **Capture Phase Strategy (Zero Overhead)**
> 经过实际验证，无需持续监听 `selectionchange`。只需要在用户点击 UI（如 AI 按钮）的瞬间，利用 **Capture Phase (捕获阶段)** 的 `mousedown` 事件抢在浏览器清除选区之前获取内容即可。

**选区获取方式**：
```typescript
// ✅ Scheme B: Instant Capture (无被动监听)
// 在 UI 元素的 mousedown (Capture Phase) 事件中执行：
const iframe = activeNode.querySelector('iframe');
const selection = iframe.contentDocument.getSelection();
cacheSelection(selection); // 立即缓存

// 随后 click 事件触发时，使用缓存的 selection
```

**Why it works**:
- `mousedown` (Capture) -> 此时焦点还在 iframe 内，选区有效。
- `mousedown` (Bubble)
- `blur` (Iframe 失去焦点，选区可能丢失)
- `click` (按钮触发)

**推荐实现** (最终采纳方案):
```typescript
// main.ts
const captureMousedown = (evt: MouseEvent) => {
    // 检查是否点击了 AI 界面元素
    if (isAiInterface(evt.target)) {
        // 强制尝试捕获当前焦点所在的选区 (Global Check or Active Node Check)
        this.captureTextSelectionContext(true);
    }
}
document.addEventListener('mousedown', captureMousedown, true); // Use Capture Phase
```

> **Discarded Approaches**:
> - Global `selectionchange` listener: 性能开销大 (CPU overhead).
> - Active Node `selectionchange` listener: 逻辑复杂，需动态挂载/卸载.


### 4.2 IntentResolver 扩展 - [x] Implemented
扩展 `IntentResolver` 类，增加 `resolveForNodeEdit` 方法：

```typescript
interface SelectionContext {
    nodeId: string;
    selectedText: string;
    preText: string;
    postText: string;
    fullText: string;  // 新增：完整节点文本
}

// 新增方法：专门处理 Edit 模式的上下文解析
static async resolveForNodeEdit(app, canvas, context, prompt, settings): Promise<NodeEditIntent>
```

### 4.3 Prompt Engineering (Text Mode) - [x] Implemented

**System Prompt (Template)**:
```markdown
You are an expert editor directly modifying a section of text within a larger document.
Your task: Rewrite the <target> text based on the User Instruction.

Context:
The text is a node in a knowledge graph.
- Incoming connections provide source material.
- The surrounding text in the node provides immediate context.

Input Format:
[Background Context from Graph]
...

[Current Node]
... {pre_text} <target>{selected_text}</target> {post_text} ...

Instruction: {user_instruction}

Output:
Return ONLY the replaced text in JSON format: {"replacement": "your text here"}
```

## 6. 限制与边界 (Constraints)

1.  **Scope**: 支持 Text Node 和 **File Node (.md)** 的编辑。 ✅
    *   **Text Node**: 直接修改 `node.text` 属性
    *   **File Node**: 通过 `vault.modify()` 写入源文件
    *   **初期限制**: File Node 仅支持整个内容编辑，不支持选中部分文本

2.  **Token Limit & Pruning Strategy**: ⏳ (Future Enhancement)
    *   **问题**: 上游节点过多可能导致 Context 爆炸或超出模型窗口。
    *   **策略**: 实施 **Distance-based Context Pruning** (基于距离的剪枝)。
        *   **算法**: 使用 BFS (广度优先搜索) 遍历上游节点。
        *   **权重**: defining `weight = 1 / (distance + 1)`. 优先保留直接相连的节点 (distance 1)。
        *   **截断**: 当达到 `MAX_TOKENS` 或 `MAX_NODE_COUNT` 时，丢弃距离最远的节点。
        *   **关键路**: 始终保留带有强 Label（如 "Critical Context"）的路径，即使距离较远。
    *   **当前状态**: 暂未实现，作为后续优化项。

3.  **Image Inputs**: ✅
    *   **上游图片节点**: 正确处理连接的 Image 节点，作为 Vision Context 传入
    *   **Markdown 内嵌图片**: 解析 `![[image.png]]` 语法，提取图片作为上下文
    *   **图片格式**: 使用 `CanvasConverter.readSingleImageFile()` 压缩为 WebP/Base64

## 7. File Node 编辑实现 (File Node Edit Support)

> [!NOTE]
> 2024-12-30 新增功能

### 7.1 技术发现

File Node 在编辑模式下**同样使用 IFRAME 渲染**，DOM 结构与 Text Node 一致：
```
.canvas-node
  └─ .canvas-node-container
       └─ .canvas-node-content
            └─ <iframe class="embed-iframe">
                 └─ #document (Markdown 渲染内容)
```

### 7.2 实现方案

1. **SelectionContext 扩展**:
```typescript
interface SelectionContext {
    nodeId: string;
    selectedText: string;
    preText: string;
    postText: string;
    fullText: string;
    isExplicit?: boolean;
    fileNode?: TFile;  // 新增：如果是 File Node，保存文件引用
}
```

2. **File Node 识别**:
```typescript
// 在 captureTextSelectionContext 中
if (node.file?.extension === 'md') {
    const fullText = await app.vault.cachedRead(node.file);
    context.fileNode = node.file;
    // ...
}
```

3. **文件写入**:
```typescript
// 新增方法
async applyEditToFileNode(file: TFile, originalText: string, newText: string) {
    const content = await this.app.vault.cachedRead(file);
    const updated = content.replace(originalText, newText);
    await this.app.vault.modify(file, updated);
}
```

### 7.3 内嵌图片解析

解析 Markdown 文件中的 `![[image]]` 语法：
```typescript
function extractEmbeddedImages(content: string): string[] {
    const regex = /!\[\[([^\]]+\.(png|jpg|jpeg|gif|webp))\]\]/gi;
    const matches = [];
    let match;
    while ((match = regex.exec(content)) !== null) {
        matches.push(match[1]);
    }
    return matches;
}
```

### 7.4 限制

> [!WARNING]
> - File Node 仅支持**整个内容**作为编辑目标，不支持选中部分文本（因 IFRAME 内选区捕获复杂度）
> - 修改后依赖 Obsidian 自动刷新机制同步视图
