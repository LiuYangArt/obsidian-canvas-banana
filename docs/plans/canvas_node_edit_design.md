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
    *   **Direct Replacement**: AI 生成的内容直接替换选中的文本（或显示 Diff 供确认，取决于 Text Generation 模式）。

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

### 3.3 顺序与关系
使用 `IntentResolver.preprocess` 和 `extractEdges` 确保顺序正确：
1.  **DFS/Topological Sort**: 确保上游上下文按逻辑顺序排列。
2.  **Label Context**: 连线上的 Label 也必须包含（如 "Supports", "Refutes"），这对理解上下文关系至关重要。

## 4. 设计协同与增强 (Synergies with Notes Design)

参考 `docs/plans/2025-12-29-notes-ai-support-design.md`，从 Notes AI 设计中汲取以下关键特性以增强 Canvas 体验：

### 4.1 安全替换 (Diff-based Safety)
原计划的 "Direct Replacement" 在长文本或复杂修改中风险较高。
*   **采纳方案**: 引入 **Diff Popover** (或简单的 Before/After 预览)。
*   **流程**: AI 生成 -> 解析 JSON Patches -> 弹窗显示 "Diff" -> 用户确认 -> 应用。
*   **System Prompt 增强**: 要求 AI 返回 JSON 格式的修改建议，而非全文直接覆盖，这与 Notes 模式的防丢失策略保持一致。

### 4.2 UI 组件复用 (Unified Floating Palette)
*   **目标**: 保持 Notes 和 Canvas Node 编辑体验的一致性。
*   **实现**: 重构 `FloatingPalette` 为通用组件，支持 `mode: 'canvas-chat' | 'canvas-node' | 'note-edit'`。
*   **共享功能**: 预设选择器、Prompt 输入框、Context Toggle 开关。

### 4.3 预设系统对齐 (Aligned Presets)
*   **架构**: 扩展 `data.json` 结构，明确区分 `canvasPresets`, `canvasNodePresets`, 和 `notePresets`。
*   **独立性**: 确保 Node Mode 拥有独立的 System Prompt 设置（如 "You are a succinct flowchart node editor"），避免与通用的 Chat 或长文写作混淆。
*   **Prompt 组合策略 (Prompt Composition)**:
    *   **User System Prompt**: 用户定义的角色、语言偏好 (如 "Always answer in Chinese")。
    *   **Functional Constraints (Hardcoded)**: 插件强制的格式要求 (Diff/JSON Patch)。
    *   **合并逻辑**: 最终发送给 LLM 的 System Prompt 将是 `User_System_Prompt + "\n\n" + Functional_Constraints`。这确保了既遵守用户的语言/语气设定，又严格执行技术上的格式要求。

## 5. 技术实现方案 (Implementation)

### 5.1 获取编辑器选区 - 关键技术发现

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

**选区获取方式**：
```typescript
// ❌ 错误方式：window.getSelection() 无法获取 IFRAME 内部选区
const selection = window.getSelection();  // 返回空

// ✅ 正确方式：通过 IFRAME 的 contentDocument 获取
const iframe = document.querySelector('.canvas-node iframe.embed-iframe') as HTMLIFrameElement;
const iframeDoc = iframe.contentDocument;
const selection = iframeDoc?.getSelection();  // 可获取选区
```

**选区丢失问题**：
- 用户在 IFRAME 内选中文本后，点击 AI 按钮时 IFRAME 失去焦点
- 焦点转移导致选区被清除（在 `mousedown` 捕获阶段已经为空）
- **解决方案**：使用 `selectionchange` 事件持续监控并缓存选区

**推荐实现**：
```typescript
interface SelectionContext {
    nodeId: string;
    selectedText: string;
    preText: string;
    postText: string;
    fullText: string;
}

// 1. 持续监控 IFRAME 内的选区变化
function monitorIframeSelection(): void {
    const iframes = document.querySelectorAll('.canvas-node iframe.embed-iframe');
    for (const iframe of iframes) {
        const iframeDoc = (iframe as HTMLIFrameElement).contentDocument;
        if (!iframeDoc) continue;
        
        iframeDoc.addEventListener('selectionchange', () => {
            const sel = iframeDoc.getSelection();
            if (sel && !sel.isCollapsed) {
                // 缓存有效选区
                cacheSelection(sel, iframe);
            }
        });
    }
}

// 2. 点击 AI 按钮时使用缓存的选区
function getTextSelectionContext(): SelectionContext | null {
    // 优先使用缓存
    if (cachedSelectionContext) {
        return cachedSelectionContext;
    }
    // 尝试实时获取（可能已丢失）
    return captureIframeSelection();
}
```


### 4.2 IntentResolver 扩展
扩展 `IntentResolver.resolve` 方法，增加 `selectionContext` 参数：

```typescript
interface SelectionContext {
    nodeId: string;
    selectedText: string;
    preText: string;
    postText: string;
}

// 在 resolve 时，除了 nodes 和 edges，额外注入 selection 信息
```

### 4.3 Prompt Engineering (Text Mode)

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
Return ONLY the replaced text. Do not output markdown fences or explanations unless asked.
```

## 5. 限制与边界 (Constraints)

1.  **Scope**: 初期仅支持 Text Node 的内部文本编辑。File Node (MD) 暂不支持（因涉及文件读写权限和视图同步，较复杂）。
2.  **Token Limit & Pruning Strategy**:
    *   **问题**: 上游节点过多可能导致 Context 爆炸或超出模型窗口。
    *   **策略**: 实施 **Distance-based Context Pruning** (基于距离的剪枝)。
        *   **算法**: 使用 BFS (广度优先搜索) 遍历上游节点。
        *   **权重**: defining `weight = 1 / (distance + 1)`. 优先保留直接相连的节点 (distance 1)。
        *   **截断**: 当达到 `MAX_TOKENS` 或 `MAX_NODE_COUNT` 时，丢弃距离最远的节点。
        *   **关键路**: 始终保留带有强 Label（如 "Critical Context"）的路径，即使距离较远。
3.  **Image Inputs**: 必须正确处理上游图片节点，将其作为 `inline_data` 或 `image_url` 传入给支持 Vision 的模型 (Gemini 3 Pro)。
