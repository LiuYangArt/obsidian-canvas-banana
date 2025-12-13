import { App, TFile, Notice } from 'obsidian';

export interface ProcessedPart {
    type 'text'  'image_url';
    text string;
    image_url { url string };
}


  智能解析器：将 Canvas 节点网络转换为 Gemini 3 的多模态 Structural Payload
 
export async function resolveCanvasContext(
    canvasData any, 
    selectedNodeIds Setstring, 
    app App
) PromiseProcessedPart[] {
    
    const parts ProcessedPart[] = [];
    
     1. 分类选中节点
    const imageNodes = canvasData.nodes.filter((n any) = selectedNodeIds.has(n.id) && n.type === 'file');
    const textNodes = canvasData.nodes.filter((n any) = selectedNodeIds.has(n.id) && n.type === 'text');
    const groupNodes = canvasData.nodes.filter((n any) = selectedNodeIds.has(n.id) && n.type === 'group');

     2. 预处理：构建节点索引和连线映射 (Adjacency Map)
     为了快速查找 谁连着谁
    const incomingEdgesMap = new Mapstring, any[]();  targetId - edges[]
    canvasData.edges.forEach((edge any) = {
        if (!incomingEdgesMap.has(edge.toNode)) incomingEdgesMap.set(edge.toNode, []);
        incomingEdgesMap.get(edge.toNode).push(edge);
    });

     辅助函数：尝试获取一张图片的“身份描述”
     优先级：连线上的 Label  指向它的文本节点内容  所在的 Group Label  默认 Reference Image
    const getImageRole = (imgNode any, index number) string = {
        const edges = incomingEdgesMap.get(imgNode.id)  [];
        
         A. 检查连线上的 Label (例如连线上写了 Style)
        const labeledEdge = edges.find(e = e.label && e.label.trim().length  0);
        if (labeledEdge) return labeledEdge.label;

         B. 检查指向它的文本节点 (例如 风格参考 --指向-- 图片)
         且该文本节点必须也在选中范围内 (或者放宽限制：只要在 Canvas 上存在即可，这里假设需选中或紧邻)
        const textSourceEdge = edges.find(e = {
            const sourceNode = canvasData.nodes.find((n any) = n.id === e.fromNode);
            return sourceNode && sourceNode.type === 'text';
        });
        if (textSourceEdge) {
            const sourceNode = canvasData.nodes.find((n any) = n.id === textSourceEdge.fromNode);
            if (sourceNode.text) return sourceNode.text.substring(0, 50).trim();  截取前50字作为Tag
        }

         C. 检查 Group (图片是否在某个 Group 里)
        const parentGroup = groupNodes.find((g any) = 
            imgNode.x = g.x && imgNode.x + imgNode.width = g.x + g.width &&
            imgNode.y = g.y && imgNode.y + imgNode.height = g.y + g.height
        );
        if (parentGroup.label) return parentGroup.label;

        return `Reference Image ${index + 1}`;
    };

     3. 开始构造 Payload
     Gemini 3 最佳实践：先给 SystemContext，再给 Images，最后给 Instruction

    let systemContext = You are an expert art director. Generate an image based on the provided references.;
    parts.push({ type 'text', text systemContext });

     4. 处理图片 (Interleaved Images with Explicit Roles)
    let imgIndex = 0;
    for (const imgNode of imageNodes) {
         读取二进制并转 Base64
        const file = app.vault.getAbstractFileByPath(imgNode.file);
        if (!(file instanceof TFile)) continue;
        
        const arrayBuffer = await app.vault.readBinary(file);
         简单的 ArrayBuffer 转 Base64
        const base64 = Buffer.from(arrayBuffer).toString('base64'); 
        
         获取这张图的“语义角色”
        const role = getImageRole(imgNode, imgIndex);
        
         构造描述性文本，告诉 Gemini 这张图是什么
         使用类似 XML 标签的格式或者自然语言格式，Gemini 对此理解能力很强
        parts.push({
            type 'text',
            text `n[Reference ${imgIndex + 1}] ${role}n`
        });

        parts.push({
            type 'image_url',
            image_url { url `dataimage${file.extension};base64,${base64}` }
        });
        
        imgIndex++;
    }

     5. 处理文本指令 (Instruction)
     过滤掉那些单纯用来做“标签”的文本节点 (即已经通过连线指向图片的文本)，避免重复干扰
     剩下的文本节点通常是全局指令，例如 把目标图片按风格参考重新绘制...
    const instructionNodes = textNodes.filter((n any) = {
         如果这个节点是某个 Edge 的 Source，且 Target 是个图片，那它大概率是个标签，跳过
        const isLabel = canvasData.edges.some((e any) = e.fromNode === n.id && imageNodes.some((img any) = img.id === e.toNode));
        return !isLabel;
    });

    let finalPrompt = nnINSTRUCTIONn;
    if (instructionNodes.length  0) {
        instructionNodes.forEach((n any) = finalPrompt += `${n.text}n`);
    } else {
         如果没有选中文本指令，提供一个默认的
        finalPrompt += Combine the above reference images creatively.;
    }

    parts.push({ type 'text', text finalPrompt });
    
    return parts;
}
```

### 2. 这个代码如何处理您的案例？

让我们模拟一下代码在处理您提供的 `image_745e5c.jpg` 时的运行逻辑：

1.  输入数据：
     节点 A 图片 (左边的人物照)
     节点 B 文本 目标图片 (位于 A 上方，假设有一条连线 A - B，或者通过 Group 判定)
     节点 C 图片 (中间的动漫图)
     节点 D 文本 风格参考 (位于 C 上方)
     节点 E 文本 把目标图片按风格参考重新绘制... (最下方)

2.  `getImageRole` 执行：
     对于 节点 A：代码发现有一个文本节点 B 连向它（或者它是 Group 的一部分），提取出 Label = 目标图片。
     对于 节点 C：代码发现文本节点 D 连向它，提取出 Label = 风格参考。

3.  生成的 Payload (发给 Gemini 的内容)：

    ```json
    [
      { type text, text You are an expert art director... },
      
      { type text, text n[Reference 1] 目标图片n }, 
      { type image_url, image_url { url dataimagepng;base64,... } },  左图 Base64
      
      { type text, text n[Reference 2] 风格参考n },
      { type image_url, image_url { url dataimagepng;base64,... } },  中图 Base64
      
      { type text, text nnINSTRUCTIONn把目标图片按风格参考重新绘制，保持原图构图姿势角度完全一致。 }
    ]