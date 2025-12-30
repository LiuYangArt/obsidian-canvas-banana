/**
 * Intent Resolver - 智能意图解析管线
 * 将 Canvas 的拓扑结构翻译为 Gemini 能理解的语义结构
 * 
 * 设计文档参考: design_doc_v2.md 3.2-3.6
 */

import { App } from 'obsidian';
import type { Canvas, CanvasNode, SelectionContext } from '../types';
import { CanvasConverter, ConvertedNode, ConvertedEdge } from './canvas-converter';
import type { CanvasAISettings } from '../settings/settings';

// ========== Constants ==========

const MAX_REFERENCE_IMAGES = 14;  // Gemini 3 limit
const DEFAULT_ROLE = 'Visual Reference';
const MAX_ROLE_TEXT_LENGTH = 50;  // Truncate long role text

// Supported image extensions
const SUPPORTED_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'];

// ========== Types ==========

/**
 * 带角色的图片数据
 */
export interface ImageWithRole {
    base64: string;
    mimeType: string;
    role: string;
    nodeId: string;
}

/**
 * 预处理结果
 */
export interface PreprocessResult {
    effectiveNodes: ConvertedNode[];
    skippedFiles: string[];
    warnings: string[];
    imageCount: number;
    textCount: number;
}

/**
 * 完整的意图解析结果
 */
export interface ResolvedIntent {
    nodes: ConvertedNode[];   // 所有有效节点（含 PDF）
    images: ImageWithRole[];
    instruction: string;
    contextText: string;
    warnings: string[];
    canGenerate: boolean;
}

/**
 * 节点编辑模式的意图解析结果
 */
export interface NodeEditIntent {
    targetText: string;         // 选中的文本（即将被编辑的内容）
    preText: string;            // 选区前文本
    postText: string;           // 选区后文本
    upstreamContext: string;    // 上游节点内容（作为背景）
    downstreamContext: string;  // 下游节点内容（作为约束）
    images: ImageWithRole[];    // 上游图片
    instruction: string;        // 用户指令
    warnings: string[];
    canEdit: boolean;
}

// ========== Intent Resolver Class ==========

export class IntentResolver {

    /**
     * 主入口：完整解析选区意图
     */
    static async resolve(
        app: App,
        canvas: Canvas,
        selection: Set<CanvasNode>,
        userInput: string,
        mode: 'chat' | 'image' | 'node',
        settings: CanvasAISettings
    ): Promise<ResolvedIntent> {
        const warnings: string[] = [];

        // Step 0: 预处理 - 展开 Group、根据模式过滤节点
        const preprocessed = await this.preprocess(
            app, canvas, selection, settings.imageCompressionQuality, settings.imageMaxSize, mode
        );
        warnings.push(...preprocessed.warnings);

        // Step 1: 角色解析 - 基于图谱确定每张图片的语义角色
        const edges = CanvasConverter.extractEdges(canvas, new Set(preprocessed.effectiveNodes.map(n => n.id)));
        const imageRoles = this.assignRoles(preprocessed.effectiveNodes, edges, canvas, selection);

        // Step 2: 指令策略 - 确定最终发给 AI 的文本指令
        const usedAsLabelIds = this.getUsedAsLabelIds(preprocessed.effectiveNodes, edges);
        const { instruction, usedAsInstructionIds } = this.resolveInstruction(userInput, preprocessed.effectiveNodes, usedAsLabelIds, mode);

        // Merge used IDs: nodes used as labels OR as instruction should not appear in context
        const excludeFromContextIds = new Set([...usedAsLabelIds, ...usedAsInstructionIds]);

        // 构建图片列表（带角色）
        const images: ImageWithRole[] = [];
        preprocessed.effectiveNodes.forEach(node => {
            if (node.isImage && node.base64) {
                images.push({
                    base64: node.base64,
                    mimeType: node.mimeType || 'image/png',
                    role: imageRoles.get(node.id) || DEFAULT_ROLE,
                    nodeId: node.id
                });
            }
        });

        // 防呆检查：图片数量限制
        if (images.length > MAX_REFERENCE_IMAGES) {
            warnings.push(`Selected images (${images.length}) exceed the limit (${MAX_REFERENCE_IMAGES}). First ${MAX_REFERENCE_IMAGES} will be used.`);
            images.splice(MAX_REFERENCE_IMAGES);
        }

        // 构建上下文文本（非图片内容，排除已用作标签或指令的节点）
        const contextText = this.buildContextText(preprocessed.effectiveNodes, excludeFromContextIds);

        // 判断是否可以生成
        const canGenerate = images.length > 0 || instruction.trim().length > 0 || contextText.length > 0;

        console.debug('Canvas AI IntentResolver:', {
            imagesCount: images.length,
            instructionLength: instruction.length,
            contextLength: contextText.length,
            warnings,
            canGenerate
        });

        return {
            nodes: preprocessed.effectiveNodes,
            images,
            instruction,
            contextText,
            warnings,
            canGenerate
        };
    }

    /**
     * Step 0: 选区预处理
     * - 展开 Group 节点
     * - 根据模式过滤节点（Image 模式跳过 PDF/Link/.md，Chat/Node 模式保留）
     * - 读取文件内容
     */
    static async preprocess(
        app: App,
        canvas: Canvas,
        selection: Set<CanvasNode>,
        compressionQuality: number,
        maxSize: number,
        mode: 'chat' | 'image' | 'node'
    ): Promise<PreprocessResult> {
        const warnings: string[] = [];
        const skippedFiles: string[] = [];

        // 展开 Group 节点
        const expandedSelection = CanvasConverter.expandGroupNodes(canvas, selection);

        // 提取节点并过滤
        const allNodes = CanvasConverter.extractNodes(expandedSelection);
        const effectiveNodes: ConvertedNode[] = [];

        for (const node of allNodes) {
            if (node.type === 'file' && node.filePath) {
                const ext = node.filePath.split('.').pop()?.toLowerCase() || '';

                if (node.isImage) {
                    // 图片文件：所有模式都包含
                    effectiveNodes.push(node);
                } else if (node.isPdf) {
                    // PDF 文件：Chat/Node 模式包含，Image 模式跳过
                    if (mode === 'image') {
                        skippedFiles.push(node.filePath);
                    } else {
                        effectiveNodes.push(node);
                    }
                } else if (ext === 'md') {
                    // .md 文件：Chat/Node 模式包含，Image 模式跳过
                    if (mode === 'image') {
                        skippedFiles.push(node.filePath);
                    } else {
                        effectiveNodes.push(node);
                    }
                } else if (!SUPPORTED_IMAGE_EXTENSIONS.includes(ext)) {
                    // 其他非图片文件：跳过
                    skippedFiles.push(node.filePath);
                } else {
                    effectiveNodes.push(node);
                }
            } else if (node.type === 'link') {
                // Link 节点：Chat/Node 模式包含，Image 模式跳过
                if (mode === 'image') {
                    skippedFiles.push(`[Link] ${node.content}`);
                } else {
                    effectiveNodes.push(node);
                }
            } else {
                // 文本节点、Group 节点等
                effectiveNodes.push(node);
            }
        }

        if (skippedFiles.length > 0) {
            warnings.push(`Skipped ${skippedFiles.length} file(s) in ${mode} mode: ${skippedFiles.map(f => f.split('/').pop()).join(', ')}`);
        }

        // 读取 .md 文件内容
        await CanvasConverter.readMdFileContents(app, effectiveNodes);

        // 读取 PDF 文件内容
        await CanvasConverter.readPdfFileContents(app, effectiveNodes);

        // 读取图片内容
        await CanvasConverter.readImageFileContents(app, effectiveNodes, compressionQuality, maxSize);

        // 统计
        let imageCount = 0;
        let textCount = 0;
        effectiveNodes.forEach(node => {
            if (node.isImage) imageCount++;
            else textCount++;
        });

        return {
            effectiveNodes,
            skippedFiles,
            warnings,
            imageCount,
            textCount
        };
    }

    /**
     * Step 1: 角色解析
     * 优先级：显式连线 Label > 上游文本 > Group 标题 > 默认角色
     */
    static assignRoles(
        nodes: ConvertedNode[],
        edges: ConvertedEdge[],
        canvas: Canvas,
        originalSelection: Set<CanvasNode>
    ): Map<string, string> {
        const roleMap = new Map<string, string>();
        const visited = new Set<string>();  // 循环检测

        // 构建节点 ID -> 节点的映射
        const nodeMap = new Map<string, ConvertedNode>();
        nodes.forEach(n => nodeMap.set(n.id, n));

        // 构建边的快速查找：toId -> edges
        const incomingEdges = new Map<string, ConvertedEdge[]>();
        edges.forEach(edge => {
            if (!incomingEdges.has(edge.toId)) {
                incomingEdges.set(edge.toId, []);
            }
            incomingEdges.get(edge.toId)!.push(edge);
        });

        // 获取原始选区中的 Group 节点（保留其 label 作为语义上下文）
        const groupLabels = new Map<string, string>();
        originalSelection.forEach(node => {
            if (node.label !== undefined) {
                groupLabels.set(node.id, node.label);
            }
        });

        // 为每个图片节点分配角色
        for (const node of nodes) {
            if (!node.isImage) continue;

            let role = DEFAULT_ROLE;

            // 优先级 1: 显式连线 Label
            const incoming = incomingEdges.get(node.id) || [];
            for (const edge of incoming) {
                if (edge.label && edge.label.trim()) {
                    role = this.truncateRole(edge.label.trim());
                    break;
                }
            }

            // 优先级 2: 上游文本节点
            if (role === DEFAULT_ROLE) {
                for (const edge of incoming) {
                    const sourceNode = nodeMap.get(edge.fromId);
                    if (sourceNode && sourceNode.type === 'text' && sourceNode.content) {
                        // 检查循环
                        if (!visited.has(edge.fromId)) {
                            visited.add(edge.fromId);
                            role = this.truncateRole(sourceNode.content);
                            break;
                        }
                    }
                }
            }

            // 优先级 3: Group 标题（如果节点是 Group 成员）
            if (role === DEFAULT_ROLE && node.isGroupMember) {
                // 找到包含此节点的 Group
                for (const [, label] of groupLabels) {
                    if (label && label.trim()) {
                        role = this.truncateRole(label);
                        break;
                    }
                }
            }

            roleMap.set(node.id, role);
        }

        return roleMap;
    }

    /**
     * Step 2: 指令回退策略
     * Priority A: 用户输入 > Priority B: 选区文本 > Priority C: 默认预设
     * Returns both instruction and the IDs of text nodes used as instruction
     */
    static resolveInstruction(
        userInput: string,
        nodes: ConvertedNode[],
        usedAsLabelIds: Set<string>,
        mode: 'chat' | 'image' | 'node'
    ): { instruction: string; usedAsInstructionIds: Set<string> } {
        const usedAsInstructionIds = new Set<string>();

        // Priority A: 用户显式输入
        if (userInput && userInput.trim()) {
            return { instruction: userInput.trim(), usedAsInstructionIds };
        }

        // Priority B: 未被用作标签的文本节点内容
        const textContents: string[] = [];
        for (const node of nodes) {
            if (node.type === 'text' && node.content && !usedAsLabelIds.has(node.id)) {
                textContents.push(node.content.trim());
                usedAsInstructionIds.add(node.id);  // Mark as used for instruction
            }
        }

        if (textContents.length > 0) {
            return { instruction: textContents.join('\n\n'), usedAsInstructionIds };
        }

        // Priority C: Default preset based on mode
        if (mode === 'chat') {
            return { instruction: 'Summarize the selected content.', usedAsInstructionIds };
        } else if (mode === 'image') {
            return { instruction: 'Generate an image based on these references.', usedAsInstructionIds };
        } else {
            // Node mode
            return { instruction: 'Generate a flowchart or structure based on the context.', usedAsInstructionIds };
        }
    }

    /**
     * 构建上下文文本（用于 Chat 模式的 system prompt）
     */
    static buildContextText(nodes: ConvertedNode[], usedAsLabelIds: Set<string>): string {
        const parts: string[] = [];

        for (const node of nodes) {
            if (node.isImage) continue;  // 图片单独处理

            if (usedAsLabelIds.has(node.id)) continue;  // 已被用作标签

            if (node.type === 'text' && node.content) {
                parts.push(`[Text Node]\n${node.content}`);
            } else if (node.type === 'file' && node.fileContent) {
                // .md 文件：内容已读取到 fileContent
                const filename = node.filePath?.split('/').pop() || 'file';
                parts.push(`[File: ${filename}]\n${node.fileContent}`);
            } else if (node.type === 'file' && node.isPdf && node.pdfBase64) {
                // PDF 文件：标记为附件（实际内容通过 multimodal API 发送）
                const filename = node.filePath?.split('/').pop() || 'file.pdf';
                parts.push(`[PDF: ${filename}] (Content provided as inline PDF attachment)`);
            } else if (node.type === 'link' && node.content) {
                parts.push(`[Link: ${node.content}]`);
            }
        }

        return parts.join('\n\n---\n\n');
    }

    /**
     * 获取被用作标签的节点 ID 集合
     */
    private static getUsedAsLabelIds(nodes: ConvertedNode[], edges: ConvertedEdge[]): Set<string> {
        const usedIds = new Set<string>();
        const nodeMap = new Map<string, ConvertedNode>();
        nodes.forEach(n => nodeMap.set(n.id, n));

        // 检查哪些文本节点被用作图片的语义标签
        for (const edge of edges) {
            const targetNode = nodeMap.get(edge.toId);
            const sourceNode = nodeMap.get(edge.fromId);

            // 如果文本节点连向图片节点，该文本被视为标签
            if (sourceNode && sourceNode.type === 'text' && targetNode && targetNode.isImage) {
                usedIds.add(sourceNode.id);
            }
        }

        return usedIds;
    }

    /**
     * 截断角色文本
     */
    private static truncateRole(text: string): string {
        const cleaned = text.replace(/\n/g, ' ').trim();
        if (cleaned.length <= MAX_ROLE_TEXT_LENGTH) {
            return cleaned;
        }
        return cleaned.substring(0, MAX_ROLE_TEXT_LENGTH - 3) + '...';
    }

    // ========== Node Edit Mode Methods ==========

    /**
     * 节点编辑模式：解析选区上下文和图谱关系
     * 使用 BFS 遍历上游/下游节点，按距离权重提取上下文
     */
    static async resolveForNodeEdit(
        app: App,
        canvas: Canvas,
        selectionContext: SelectionContext,
        userInput: string,
        settings: CanvasAISettings
    ): Promise<NodeEditIntent> {
        const warnings: string[] = [];
        const MAX_UPSTREAM_NODES = 10;
        const MAX_DOWNSTREAM_NODES = 5;

        // 获取当前编辑节点
        const currentNode = canvas.nodes.get(selectionContext.nodeId);
        if (!currentNode) {
            return {
                targetText: selectionContext.selectedText,
                preText: selectionContext.preText,
                postText: selectionContext.postText,
                upstreamContext: '',
                downstreamContext: '',
                images: [],
                instruction: userInput || 'Polish this text.',
                warnings: ['Node not found in canvas'],
                canEdit: false
            };
        }

        // 构建边的快速查找
        const incomingEdges = new Map<string, { fromId: string; label?: string }[]>();
        const outgoingEdges = new Map<string, { toId: string; label?: string }[]>();

        canvas.edges.forEach(edge => {
            const fromId = edge.from?.node?.id;
            const toId = edge.to?.node?.id;
            if (fromId && toId) {
                // 入边 (toId 的上游)
                if (!incomingEdges.has(toId)) {
                    incomingEdges.set(toId, []);
                }
                incomingEdges.get(toId)!.push({ fromId, label: edge.label });

                // 出边 (fromId 的下游)
                if (!outgoingEdges.has(fromId)) {
                    outgoingEdges.set(fromId, []);
                }
                outgoingEdges.get(fromId)!.push({ toId, label: edge.label });
            }
        });

        // BFS 遍历上游节点
        const upstreamNodes = this.bfsTraverse(
            selectionContext.nodeId,
            incomingEdges,
            canvas.nodes,
            MAX_UPSTREAM_NODES,
            'upstream'
        );

        // BFS 遍历下游节点
        const downstreamNodes = this.bfsTraverse(
            selectionContext.nodeId,
            outgoingEdges,
            canvas.nodes,
            MAX_DOWNSTREAM_NODES,
            'downstream'
        );

        // 处理上游节点：提取文本和图片
        const upstreamParts: string[] = [];
        const images: ImageWithRole[] = [];

        for (const { node, distance, label } of upstreamNodes) {
            // 处理图片节点
            if (node.file && this.isImageFile(node.file.path || '')) {
                try {
                    const base64 = await CanvasConverter.readSingleImageFile(
                        app,
                        node.file.path,
                        settings.imageCompressionQuality,
                        settings.imageMaxSize
                    );
                    if (base64) {
                        images.push({
                            base64: base64.base64,
                            mimeType: base64.mimeType,
                            role: label || `Reference (distance ${distance})`,
                            nodeId: node.id
                        });
                    }
                } catch (e) {
                    console.warn('Failed to read image:', e);
                }
            }
            // 处理文本节点
            else if (node.text !== undefined) {
                const rolePrefix = label ? `[${label}] ` : '';
                upstreamParts.push(`${rolePrefix}${node.text}`);
            }
            // 处理 .md 文件节点
            else if (node.file && node.file.extension === 'md') {
                try {
                    const content = await app.vault.cachedRead(node.file);
                    const filename = node.file.name;
                    upstreamParts.push(`[File: ${filename}]\n${content}`);
                } catch (e) {
                    console.warn('Failed to read md file:', e);
                }
            }
        }

        // 处理下游节点：作为约束
        const downstreamParts: string[] = [];
        for (const { node, label } of downstreamNodes) {
            if (node.text !== undefined) {
                const rolePrefix = label ? `[${label}] ` : '';
                downstreamParts.push(`${rolePrefix}${node.text}`);
            }
        }

        // 限制上游图片数量
        if (images.length > MAX_REFERENCE_IMAGES) {
            warnings.push(`Upstream images (${images.length}) exceed limit. Using first ${MAX_REFERENCE_IMAGES}.`);
            images.splice(MAX_REFERENCE_IMAGES);
        }

        // 确定指令
        const instruction = userInput?.trim() || 'Polish this text.';

        return {
            targetText: selectionContext.selectedText,
            preText: selectionContext.preText,
            postText: selectionContext.postText,
            upstreamContext: upstreamParts.join('\n\n---\n\n'),
            downstreamContext: downstreamParts.join('\n\n---\n\n'),
            images,
            instruction,
            warnings,
            canEdit: selectionContext.selectedText.length > 0
        };
    }

    /**
     * BFS 遍历图谱节点
     * @param startId 起始节点 ID
     * @param edgeMap 边的映射 (节点ID -> 相邻节点)
     * @param nodeMap 节点映射
     * @param maxNodes 最大节点数
     * @param direction 遍历方向 (用于日志)
     * @returns 遍历到的节点列表（按距离排序）
     */
    private static bfsTraverse(
        startId: string,
        edgeMap: Map<string, { fromId?: string; toId?: string; label?: string }[]>,
        nodeMap: Map<string, CanvasNode>,
        maxNodes: number,
        direction: 'upstream' | 'downstream'
    ): { node: CanvasNode; distance: number; label?: string }[] {
        const result: { node: CanvasNode; distance: number; label?: string }[] = [];
        const visited = new Set<string>();
        const queue: { id: string; distance: number; label?: string }[] = [];

        visited.add(startId);

        // 初始化队列：添加起始节点的相邻节点
        const initialEdges = edgeMap.get(startId) || [];
        for (const edge of initialEdges) {
            const neighborId = direction === 'upstream' ? edge.fromId : edge.toId;
            if (neighborId && !visited.has(neighborId)) {
                queue.push({ id: neighborId, distance: 1, label: edge.label });
                visited.add(neighborId);
            }
        }

        // BFS 遍历
        while (queue.length > 0 && result.length < maxNodes) {
            const { id, distance, label } = queue.shift()!;
            const node = nodeMap.get(id);

            if (node) {
                result.push({ node, distance, label });

                // 继续遍历更远的节点
                const nextEdges = edgeMap.get(id) || [];
                for (const edge of nextEdges) {
                    const neighborId = direction === 'upstream' ? edge.fromId : edge.toId;
                    if (neighborId && !visited.has(neighborId)) {
                        queue.push({ id: neighborId, distance: distance + 1, label: edge.label });
                        visited.add(neighborId);
                    }
                }
            }
        }

        console.debug(`IntentResolver: BFS ${direction} found ${result.length} nodes from ${startId}`);
        return result;
    }

    /**
     * 判断文件是否为图片
     */
    private static isImageFile(filePath: string): boolean {
        const ext = filePath.split('.').pop()?.toLowerCase() || '';
        return SUPPORTED_IMAGE_EXTENSIONS.includes(ext);
    }
}
