/**
 * CanvasConverter.ts
 * 用于将 Obsidian Canvas JSON 转换为 LLM 易读格式的工具类
 */

interface CanvasNode {
    id: string;
    type: 'text' | 'file' | 'link' | 'group';
    text?: string;
    file?: string;
    label?: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

interface CanvasEdge {
    id: string;
    fromNode: string;
    toNode: string;
    label?: string;
}

interface CanvasData {
    nodes: CanvasNode[];
    edges: CanvasEdge[];
}

export class CanvasConverter {

    /**
     * 将 Canvas 数据转换为 Mermaid 流程图格式
     * 优势：保留所有连接关系和分组结构，适合逻辑分析
     */
    public static toMermaid(data: CanvasData): string {
        const { nodes, edges } = data;
        const nodeMap = new Map<string, CanvasNode>(nodes.map(n => [n.id, n]));
        
        // 1. 识别分组关系 (基于几何坐标)
        const groups = nodes.filter(n => n.type === 'group');
        const childrenMap = new Map<string, string[]>(); // groupId -> [childIds]
        const processedNodes = new Set<string>(); // 记录已被归入组的节点

        // 简单的包围盒碰撞检测
        nodes.forEach(node => {
            if (node.type === 'group') return; // 组不包含组（简化处理，虽然Canvas支持嵌套）
            
            // 找到包含该节点的最小分组（如果有重叠，取最后一个）
            const parent = groups.find(g => 
                node.x >= g.x && 
                node.x + node.width <= g.x + g.width &&
                node.y >= g.y && 
                node.y + node.height <= g.y + g.height
            );

            if (parent) {
                if (!childrenMap.has(parent.id)) childrenMap.set(parent.id, []);
                childrenMap.get(parent.id)?.push(node.id);
                processedNodes.add(node.id);
            }
        });

        // 2. 构建 Mermaid 字符串
        let mermaid = "graph TD\n"; // 或 LR (从左到右)

        // 辅助函数：生成节点文本
        const getNodeStr = (n: CanvasNode) => {
            // 清理文本中的特殊字符，防止破坏 Mermaid 语法
            let content = "Unknown";
            if (n.type === 'text') content = (n.text || "").replace(/["\n]/g, " ").slice(0, 50); // 截断过长文本
            if (n.type === 'file') content = `FILE: ${n.file}`;
            if (n.type === 'link') content = `LINK: ${n.url}`; // 假设 link 类型有 url
            return `${n.id}["${content}"]`;
        };

        // 2.1 先输出所有 Group 及其子节点
        groups.forEach(g => {
            mermaid += `  subgraph ${g.id} ["${g.label || 'Group'}"]\n`;
            const children = childrenMap.get(g.id) || [];
            children.forEach(childId => {
                const child = nodeMap.get(childId);
                if (child) mermaid += `    ${getNodeStr(child)}\n`;
            });
            mermaid += `  end\n`;
        });

        // 2.2 输出未分组的独立节点
        nodes.forEach(n => {
            if (n.type !== 'group' && !processedNodes.has(n.id)) {
                mermaid += `  ${getNodeStr(n)}\n`;
            }
        });

        // 2.3 输出连线
        edges.forEach(e => {
            const label = e.label ? `|"${e.label}"|` : "";
            mermaid += `  ${e.fromNode} -->${label} ${e.toNode}\n`;
        });

        return mermaid;
    }

    /**
     * 将 Canvas 数据转换为 Markdown 文本
     * 优势：线性化阅读，适合总结、文章生成
     */
    public static toMarkdown(data: CanvasData): string {
        const { nodes, edges } = data;
        const nodeMap = new Map(nodes.map(n => [n.id, n]));
        
        // 1. 构建邻接表
        const adj = new Map<string, string[]>();
        const inDegree = new Map<string, number>();
        
        nodes.forEach(n => inDegree.set(n.id, 0));
        edges.forEach(e => {
            if (!adj.has(e.fromNode)) adj.set(e.fromNode, []);
            adj.get(e.fromNode)?.push(e.toNode);
            inDegree.set(e.toNode, (inDegree.get(e.toNode) || 0) + 1);
        });

        // 2. 找到根节点 (入度为0的节点)
        // 如果没有入度为0的节点（全是环），则取第一个节点作为起点
        let roots = nodes.filter(n => n.type !== 'group' && (inDegree.get(n.id) === 0));
        if (roots.length === 0 && nodes.length > 0) roots = [nodes[0]];

        let output = "# Canvas Content Extraction\n\n";
        const visited = new Set<string>();

        // 3. DFS 遍历生成内容
        const traverse = (nodeId: string, depth: number) => {
            if (visited.has(nodeId)) return;
            visited.add(nodeId);

            const node = nodeMap.get(nodeId);
            if (!node || node.type === 'group') return;

            // 生成标题层级
            const prefix = "#".repeat(Math.min(depth + 2, 6)); // 最深 h6
            let content = "";
            
            if (node.type === 'text') {
                content = node.text || "(Empty Text Node)";
            } else if (node.type === 'file') {
                content = `![[${node.file}]]\n*(Image/File reference)*`;
            }

            output += `${prefix} Node: ${node.id.slice(0,4)}\n${content}\n\n`;

            // 递归子节点
            const children = adj.get(nodeId) || [];
            children.forEach(childId => traverse(childId, depth + 1));
        };

        roots.forEach(r => traverse(r.id, 0));
        return output;
    }
}