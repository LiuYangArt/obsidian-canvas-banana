
这是一个独立的、针对 "Node Mode" (架构师模式/节点生成模式) 的详细设计文档。

这份文档剥离了之前的文本和图像生成逻辑，专注于 LLM 如何生成结构化 Canvas 数据 并渲染到 Obsidian 的技术细节。您可以直接将此文档交给开发人员（或作为您的开发蓝本）。
Mode
3.5 Canvas 渲染与替换
Obsidian 的非公开 API 操作步骤：

获取 Ghost Node: 记录其 id 和 x, y, width, height。

计算目标锚点: 使用 Ghost Node 的中心点作为 targetCenter。

执行 Remap: 运行上述算法。

批量添加:

遍历 data.nodes，调用 canvas.addNode(node)。

遍历 data.edges，调用 canvas.addEdge(edge)。

清理: 调用 canvas.removeNode(ghostNode)。

后续操作: 调用 canvas.select(newNodeIds) 高亮新生成的结构。

4. 设置与配置 (Configuration)
在插件的 Settings 页面，为 Node Mode 提供独立配置区：

4.1 Architect System Prompt
Type: Textarea (Long text)

Default: 内置 Obsidian Canvas Rules.md 的完整文本。

作用: 允许高级用户修改生成规则（例如：强制所有节点颜色为红色，或者改变默认节点的宽度）。

4.2 有独立的prompt preset，跟 text/ image 模式分开

5. 错误处理 (Error Handling)
Node Mode 比普通文本生成更容易出错（JSON 格式错误）。

JSON Parse Error:

Ghost Node 变红。

提示: "AI generated invalid JSON structure."

Debug Feature: 在 Console 输出 LLM 返回的原始字符串，方便开发者调试 Prompt。

Schema Validation Error (缺少 nodes 或 edges):

提示: "Incomplete structure data."

ID Collision:

如果在添加节点时发现 ID 已存在（极低概率），捕获异常并提示重试。

6. 开发测试步骤 (Implementation Steps)
建议按以下顺序开发此模块：

Step 1: Mock Test (本地模拟)

不调用 LLM。

在代码中硬编码一段标准的 Canvas JSON (例如两个连接的节点)。

实现 remapCoordinates 函数。

测试点击按钮后，能否在 Ghost Node 位置正确展开这两个硬编码节点。

Step 2: Prompt Integration

接入 LLM API。

将 Obsidian Canvas Rules.md 作为 System Prompt 发送。

测试简单的指令："Create two nodes connected by an arrow."

观察 Console 中的 JSON 返回，确保格式正确。

Step 3: Sanitizer & Rendering

实现 JSON 提取与清洗逻辑。

对接真实的 Canvas addNode 接口。

测试 Ghost Node 的替换动画效果。

Step 4: Complex Structure Test

测试复杂指令："Generate a flowchart for a login system with 5 steps and decision branches."

检查布局是否重叠，连线是否正确。













模块设计文档：Node Mode (节点生成模式)

1. 概述 (Overview)

Node Mode 是插件的一个独立功能模块，旨在利用 LLM 的逻辑构建能力，直接生成 Obsidian Canvas 的结构化数据（Nodes + Edges）。

核心差异：

Text/Chat Mode: 生成内容填充到 一个 节点中。

Node Mode: 生成 一组 具有空间关系和逻辑连接的节点，并自动布局。

输入: 用户指令 (Prompt) + 可选的上下文节点。

输出: 符合 JSONCanvas 规范的 JSON 数据，并在画布上实例化。

2. 用户交互流程 (UX/UI Flow)

2.1 入口与触发

用户在 Canvas 悬浮面板 (Floating Palette) 顶部切换到 [ 📐 Architect ] 标签。

输入框 Placeholder: "Describe a structure (e.g., 'Flowchart for login process', 'Mindmap for marketing strategy')..."

UI 变化: 此时底部的参数栏显示 "Template Style" (可选：Flowchart, Mindmap, Kanban)。

2.2 执行过程

提交任务: 用户点击 "Generate Structure"。

占位反馈: 面板收起，在用户鼠标位置（或选中区域右侧）生成一个 Ghost Node。

样式: 虚线边框，显示 "🏗️ Architecting..." 动画。

展开/替换 (The "Unpacking" Effect):

当 LLM 返回数据并通过校验后，Ghost Node 瞬间消失。

在 Ghost Node 原本的位置，展开 生成的一组新节点和连线。

新生成的所有节点自动进入 选中状态 (Selected)，方便用户整体拖拽调整位置。

3. 技术架构与管线 (Pipeline Architecture)

该模式的核心在于将自然语言转换为严格的 JSON，并将“想象坐标”映射到“真实坐标”。

3.1 数据流向

graph LR
    UserPrompt --> PromptAssembler
    PromptAssembler --> LLM_API(Gemini/OpenAI)
    LLM_API --> JSON_Sanitizer(清洗)
    JSON_Sanitizer --> JSON_Parser
    JSON_Parser --> Coordinate_Remapper(坐标重算)
    Coordinate_Remapper --> Canvas_Renderer(渲染)


3.2 Prompt Engineering (提示词工程)

这是该模式成败的关键。我们需要强制 LLM 扮演“Canvas 渲染引擎”。

System Prompt: 直接加载 Obsidian Canvas Rules.md 的内容。

User Prompt 包装:

[System Instruction]
{{ Content of Obsidian Canvas Rules.md }}

[User Request]
{{ User Input }}

[Constraint]
Output ONLY raw JSON. Do not wrap in markdown code blocks. Ensure all IDs are UUIDv4.


3.3 数据清洗与解析 (Sanitization)

LLM 即使被要求只输出 JSON，有时也会输出 json ...  或在前后加废话。

提取逻辑:

检查 response 是否包含 ```json。

如果包含，正则提取代码块内的内容。

如果不包含，尝试寻找第一个 { 和最后一个 } 之间的内容。

执行 JSON.parse()。如果失败，抛出错误并在 Canvas 上将 Ghost Node 标记为 Error。

3.4 坐标重映射算法 (Coordinate Remapping)

核心痛点: LLM 生成的 JSON 坐标通常是从 0,0 或任意位置开始的。如果不处理，新节点可能会重叠在画布原点，或者离用户视图非常远。

算法逻辑:

interface CanvasData {
    nodes: CanvasNode[];
    edges: CanvasEdge[];
}

function remapCoordinates(data: CanvasData, targetCenter: {x: number, y: number}) {
    if (data.nodes.length === 0) return data;

    // 1. 计算生成数据的包围盒 (Bounding Box)
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    data.nodes.forEach(node => {
        if (node.x < minX) minX = node.x;
        if (node.y < minY) minY = node.y;
        if (node.x + node.width > maxX) maxX = node.x + node.width;
        if (node.y + node.height > maxY) maxY = node.y + node.height;
    });

    // 2. 计算生成数据的中心点
    const generatedCenterX = minX + (maxX - minX) / 2;
    const generatedCenterY = minY + (maxY - minY) / 2;

    // 3. 计算偏移量 (Offset) = 目标位置 - 生成中心
    const deltaX = targetCenter.x - generatedCenterX;
    const deltaY = targetCenter.y - generatedCenterY;

    // 4. 应用偏移量到所有节点
    data.nodes.forEach(node => {
        node.x += deltaX;
        node.y += deltaY;
    });

    return data;
}
