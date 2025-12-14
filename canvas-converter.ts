/**
 * CanvasConverter - Canvas 节点数据转换工具类
 * 将选中的 Canvas 节点转换为 LLM 容易理解的 Markdown 和 Mermaid 格式
 */

import { App, TFile } from 'obsidian';
import type { Canvas, CanvasNode, CanvasEdge, CanvasCoords } from './types';

// ========== 转换后的数据结构 ==========

/**
 * 转换后的节点数据
 */
/**
 * 转换后的节点数据
 */
export interface ConvertedNode {
    id: string;
    type: 'text' | 'file' | 'link' | 'group';
    content: string;       // 文本内容或文件引用 ![[filename]]
    isImage: boolean;      // 是否为图片节点
    isPdf?: boolean;       // 是否为 PDF 文件
    filePath?: string;     // 文件路径（如果是文件节点）
    fileContent?: string;  // 文件实际内容（仅限 .md 文件）
    base64?: string;       // 图片Base64数据（仅限图片文件）
    pdfBase64?: string;    // PDF Base64数据（仅限 PDF 文件）
    mimeType?: string;     // MIME类型
    isGroupMember?: boolean; // 是否是通过 group 展开添加的
}

/**
 * 转换后的边（连线）数据
 */
export interface ConvertedEdge {
    id: string;
    fromId: string;
    toId: string;
    label?: string;
}

/**
 * 转换结果
 */
export interface ConversionResult {
    nodes: ConvertedNode[];
    edges: ConvertedEdge[];
    markdown: string;
    mermaid: string;
}

// ========== 文件扩展名常量 ==========
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'];
const PDF_EXTENSION = 'pdf';

/**
 * CanvasConverter 工具类
 * 提供静态方法将 Canvas 选中节点转换为不同格式
 */
export class CanvasConverter {

    /**
     * 从 Canvas selection 提取节点信息
     * @param selection 选中的节点集合
     * @returns 转换后的节点数组
     */
    static extractNodes(selection: Set<CanvasNode>): ConvertedNode[] {
        const nodes: ConvertedNode[] = [];

        selection.forEach(node => {
            const converted = this.convertNode(node);
            if (converted) {
                nodes.push(converted);
            }
        });

        return nodes;
    }

    /**
     * 转换单个节点
     */
    private static convertNode(node: CanvasNode): ConvertedNode | null {
        const id = node.id;

        // 文本节点
        if (node.text !== undefined) {
            return {
                id,
                type: 'text',
                content: node.text,
                isImage: false,
            };
        }

        // 文件节点
        if (node.file) {
            const ext = node.file.extension?.toLowerCase() || '';
            const isImage = IMAGE_EXTENSIONS.includes(ext);
            const isPdf = ext === PDF_EXTENSION;
            const fileName = node.file.name || node.file.path;

            // Basic MIME detection
            let mimeType: string | undefined = undefined;
            if (isImage) {
                mimeType = 'image/png';
                if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';
                else if (ext === 'gif') mimeType = 'image/gif';
                else if (ext === 'webp') mimeType = 'image/webp';
                else if (ext === 'svg') mimeType = 'image/svg+xml';
            } else if (isPdf) {
                mimeType = 'application/pdf';
            }

            return {
                id,
                type: 'file',
                content: isImage ? `![[${fileName}]]` : `[[${fileName}]]`,
                isImage,
                isPdf,
                mimeType,
                filePath: node.file.path,
            };
        }

        // 链接节点
        if (node.url) {
            return {
                id,
                type: 'link',
                content: node.url,
                isImage: false,
            };
        }

        // 群组节点
        if (node.label !== undefined) {
            return {
                id,
                type: 'group',
                content: node.label || '(Unnamed Group)',
                isImage: false,
            };
        }

        // 未知类型，尝试从 filePath 获取
        if (node.filePath) {
            const ext = node.filePath.split('.').pop()?.toLowerCase() || '';
            const isImage = IMAGE_EXTENSIONS.includes(ext);
            const fileName = node.filePath.split('/').pop() || node.filePath;

            return {
                id,
                type: 'file',
                content: isImage ? `![[${fileName}]]` : `[[${fileName}]]`,
                isImage,
                filePath: node.filePath,
            };
        }

        // 无法识别的节点类型
        console.warn('CanvasConverter: Unknown node type', node);
        return null;
    }

    /**
     * 获取选中节点间的边（连线）
     * @param canvas Canvas 实例
     * @param selectedIds 选中节点的 ID 集合
     * @returns 转换后的边数组
     */
    static extractEdges(canvas: Canvas, selectedIds: Set<string>): ConvertedEdge[] {
        const edges: ConvertedEdge[] = [];

        // 遍历 Canvas 中所有的边
        canvas.edges.forEach((edge: CanvasEdge) => {
            const fromId = edge.from?.node?.id;
            const toId = edge.to?.node?.id;

            // 只保留两端都在选中节点中的边
            if (fromId && toId && selectedIds.has(fromId) && selectedIds.has(toId)) {
                edges.push({
                    id: edge.id,
                    fromId,
                    toId,
                    label: (edge as any).label,  // label 可能存在于边对象上
                });
            }
        });

        return edges;
    }

    /**
     * 转换为 Markdown 格式
     * @param nodes 转换后的节点数组
     * @param edges 转换后的边数组
     * @returns Markdown 字符串
     */
    static toMarkdown(nodes: ConvertedNode[], edges: ConvertedEdge[]): string {
        const lines: string[] = [];

        lines.push('## Selected Canvas Nodes\n');

        // 输出节点
        nodes.forEach(node => {
            const typeLabel = this.getNodeTypeLabel(node);
            lines.push(`### Node: ${node.id.slice(0, 8)}... (${typeLabel})`);
            lines.push('');

            // 根据节点类型格式化内容
            if (node.type === 'text') {
                // 文本节点：直接输出内容
                lines.push(node.content);
            } else if (node.type === 'file') {
                // 文件节点：输出引用
                lines.push(node.content);
                if (node.filePath) {
                    lines.push(`> Path: ${node.filePath}`);
                }
            } else if (node.type === 'link') {
                // 链接节点：输出 URL
                lines.push(`[${node.content}](${node.content})`);
            } else if (node.type === 'group') {
                // 群组节点：输出标签
                lines.push(`**Group:** ${node.content}`);
            }

            lines.push('');
        });

        // 输出连线关系
        if (edges.length > 0) {
            lines.push('## Connections\n');
            edges.forEach(edge => {
                const fromNode = nodes.find(n => n.id === edge.fromId);
                const toNode = nodes.find(n => n.id === edge.toId);
                const fromLabel = fromNode ? edge.fromId.slice(0, 8) : edge.fromId;
                const toLabel = toNode ? edge.toId.slice(0, 8) : edge.toId;

                if (edge.label) {
                    lines.push(`- ${fromLabel}... --[${edge.label}]--> ${toLabel}...`);
                } else {
                    lines.push(`- ${fromLabel}... --> ${toLabel}...`);
                }
            });
            lines.push('');
        }

        return lines.join('\n');
    }

    /**
     * 转换为 Mermaid 流程图格式
     * @param nodes 转换后的节点数组
     * @param edges 转换后的边数组
     * @returns Mermaid 代码字符串
     */
    static toMermaid(nodes: ConvertedNode[], edges: ConvertedEdge[]): string {
        const lines: string[] = [];

        lines.push('```mermaid');
        lines.push('graph LR');

        // 输出节点定义
        nodes.forEach(node => {
            const label = this.sanitizeMermaidLabel(this.truncateContent(node.content, 50));
            const shortId = node.id.slice(0, 8);

            // 根据节点类型使用不同形状
            if (node.type === 'group') {
                // 群组使用双括号 (())
                lines.push(`    ${shortId}(("${label}"))`);
            } else if (node.isImage) {
                // 图片使用菱形 {}
                lines.push(`    ${shortId}{"${label}"}`);
            } else if (node.type === 'link') {
                // 链接使用平行四边形 [/ /]
                lines.push(`    ${shortId}[/"${label}"/]`);
            } else {
                // 文本和文件使用方括号 []
                lines.push(`    ${shortId}["${label}"]`);
            }
        });

        // 输出边连接
        edges.forEach(edge => {
            const fromShort = edge.fromId.slice(0, 8);
            const toShort = edge.toId.slice(0, 8);

            if (edge.label) {
                const label = this.sanitizeMermaidLabel(edge.label);
                lines.push(`    ${fromShort} -->|"${label}"| ${toShort}`);
            } else {
                lines.push(`    ${fromShort} --> ${toShort}`);
            }
        });

        lines.push('```');

        return lines.join('\n');
    }

    /**
     * 展开 Group 节点：获取 group 内包含的所有子节点
     * @param canvas Canvas 实例
     * @param selection 原始选中的节点集合
     * @returns 展开后的节点集合（包含 group 内的节点）
     */
    static expandGroupNodes(canvas: Canvas, selection: Set<CanvasNode>): Set<CanvasNode> {
        const expanded = new Set<CanvasNode>(selection);

        selection.forEach(node => {
            // 检测是否为 group 节点（有 label 属性）
            if (node.label !== undefined) {
                // 获取 group 的包围盒
                const bbox = node.getBBox ? node.getBBox() : node.bbox;
                if (bbox) {
                    // 使用 canvas.getContainingNodes 获取 group 区域内的所有节点
                    const containedNodes = canvas.getContainingNodes(bbox);
                    containedNodes.forEach(child => {
                        // 排除 group 自身
                        if (child.id !== node.id) {
                            expanded.add(child);
                        }
                    });
                }
            }
        });

        return expanded;
    }

    /**
     * 读取 .md 文件内容并填充到节点中
     * @param app Obsidian App 实例
     * @param nodes 转换后的节点数组
     */
    static async readMdFileContents(app: App, nodes: ConvertedNode[]): Promise<void> {
        for (const node of nodes) {
            if (node.type === 'file' && node.filePath && !node.isImage) {
                // 检查是否为 .md 文件
                if (node.filePath.endsWith('.md')) {
                    try {
                        const file = app.vault.getAbstractFileByPath(node.filePath);
                        if (file && file instanceof TFile) {
                            const content = await app.vault.cachedRead(file);
                            node.fileContent = content;
                            // 更新 content 字段为文件实际内容
                            node.content = content;
                        }
                    } catch (error) {
                        console.warn(`CanvasConverter: Failed to read file ${node.filePath}`, error);
                    }

                }
            }
        }
    }

    /**
     * 读取 PDF 文件内容并转换为 Base64
     * @param app Obsidian App 实例
     * @param nodes 转换后的节点数组
     */
    static async readPdfFileContents(app: App, nodes: ConvertedNode[]): Promise<void> {
        for (const node of nodes) {
            if (node.type === 'file' && node.filePath && node.isPdf) {
                try {
                    const file = app.vault.getAbstractFileByPath(node.filePath);
                    if (file && file instanceof TFile) {
                        const buffer = await app.vault.readBinary(file);
                        node.pdfBase64 = this.arrayBufferToBase64(buffer);
                        node.mimeType = 'application/pdf';
                        console.log(`CanvasConverter: Read PDF ${node.filePath}, base64 length: ${node.pdfBase64.length}`);
                    }
                } catch (error) {
                    console.warn(`CanvasConverter: Failed to read PDF file ${node.filePath}`, error);
                }
            }
        }
    }

    /**
     * 读取图片文件内容并转换为压缩的 WebP Base64
     * @param app Obsidian App 实例
     * @param nodes 转换后的节点数组
     * @param compressionQuality 压缩质量 (0-100)
     * @param maxSize 最大尺寸（宽/高都不超过此值）
     */
    static async readImageFileContents(app: App, nodes: ConvertedNode[], compressionQuality: number = 80, maxSize: number = 2048): Promise<void> {
        console.log('CanvasConverter: readImageFileContents called, nodes:', nodes.length, 'quality:', compressionQuality, 'maxSize:', maxSize);
        for (const node of nodes) {
            console.log(`CanvasConverter: Checking node ${node.id}, type=${node.type}, isImage=${node.isImage}, filePath=${node.filePath}`);
            if (node.type === 'file' && node.filePath && node.isImage) {
                try {
                    const file = app.vault.getAbstractFileByPath(node.filePath);
                    console.log(`CanvasConverter: File lookup result:`, file);
                    if (file && file instanceof TFile) {
                        const buffer = await app.vault.readBinary(file);

                        // Convert to compressed WebP with size limit
                        const compressedBase64 = await this.compressImageToWebP(buffer, compressionQuality, maxSize);
                        node.base64 = compressedBase64;
                        node.mimeType = 'image/webp';

                        console.log(`CanvasConverter: Compressed image ${node.filePath}, base64 length: ${node.base64.length}`);
                    } else {
                        console.warn(`CanvasConverter: File not found or not TFile: ${node.filePath}`);
                    }
                } catch (error) {
                    console.warn(`CanvasConverter: Failed to read/compress image file ${node.filePath}`, error);
                }
            }
        }
    }

    /**
     * 将 ArrayBuffer 转换为 Base64 字符串
     */
    private static arrayBufferToBase64(buffer: ArrayBuffer): string {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    }

    /**
     * 使用 Canvas API 将图片压缩为 WebP 格式
     * @param buffer 原始图片的 ArrayBuffer
     * @param quality 压缩质量 (0-100)
     * @param maxSize 最大尺寸（宽/高都不超过此值）
     * @returns Base64 编码的 WebP 图片数据（不含 data: 前缀）
     */
    private static async compressImageToWebP(buffer: ArrayBuffer, quality: number, maxSize: number = 2048): Promise<string> {
        return new Promise((resolve, reject) => {
            // Create blob from buffer
            const blob = new Blob([buffer]);
            const url = URL.createObjectURL(blob);

            // Create image element
            const img = new Image();
            img.onload = () => {
                try {
                    // Calculate target dimensions (maintain aspect ratio)
                    let targetWidth = img.width;
                    let targetHeight = img.height;

                    if (targetWidth > maxSize || targetHeight > maxSize) {
                        const scale = Math.min(maxSize / targetWidth, maxSize / targetHeight);
                        targetWidth = Math.round(targetWidth * scale);
                        targetHeight = Math.round(targetHeight * scale);
                        console.log(`CanvasConverter: Scaling image from ${img.width}x${img.height} to ${targetWidth}x${targetHeight}`);
                    }

                    // Create canvas with target dimensions
                    const canvas = document.createElement('canvas');
                    canvas.width = targetWidth;
                    canvas.height = targetHeight;

                    // Draw image to canvas (scaled)
                    const ctx = canvas.getContext('2d');
                    if (!ctx) {
                        reject(new Error('Failed to get canvas context'));
                        return;
                    }
                    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

                    // Convert to WebP with specified quality
                    const qualityDecimal = quality / 100;
                    const dataUrl = canvas.toDataURL('image/webp', qualityDecimal);

                    // Extract base64 part (remove "data:image/webp;base64," prefix)
                    const base64 = dataUrl.split(',')[1];

                    // Cleanup
                    URL.revokeObjectURL(url);

                    console.log(`CanvasConverter: Compressed ${img.width}x${img.height} -> ${targetWidth}x${targetHeight} at ${quality}% quality`);
                    resolve(base64);
                } catch (error) {
                    URL.revokeObjectURL(url);
                    reject(error);
                }
            };

            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('Failed to load image for compression'));
            };

            img.src = url;
        });
    }

    /**
     * 一键转换入口（异步版本）
     * @param app Obsidian App 实例
     * @param canvas Canvas 实例
     * @param selection 选中的节点集合
     * @param compressionQuality 图片压缩质量 (0-100)，默认 80
     * @param maxSize 图片最大尺寸（宽/高都不超过此值），默认 2048
     * @returns 完整的转换结果
     */
    static async convert(app: App, canvas: Canvas, selection: Set<CanvasNode>, compressionQuality: number = 80, maxSize: number = 2048): Promise<ConversionResult> {
        // 展开 group 节点，获取其内部所有子节点
        const expandedSelection = this.expandGroupNodes(canvas, selection);

        // 标记哪些节点是通过 group 展开添加的
        const originalIds = new Set<string>();
        selection.forEach(node => originalIds.add(node.id));

        // 提取节点
        const nodes = this.extractNodes(expandedSelection);

        // 标记 group 展开的成员节点
        nodes.forEach(node => {
            if (!originalIds.has(node.id)) {
                node.isGroupMember = true;
            }
        });

        // 读取 .md 文件内容
        await this.readMdFileContents(app, nodes);

        // 读取 PDF 文件内容
        await this.readPdfFileContents(app, nodes);

        // 读取图片文件内容（压缩为 WebP，并限制尺寸）
        await this.readImageFileContents(app, nodes, compressionQuality, maxSize);

        // 构建选中节点 ID 集合（包含展开后的节点）
        const selectedIds = new Set<string>();
        expandedSelection.forEach(node => selectedIds.add(node.id));

        // 提取边
        const edges = this.extractEdges(canvas, selectedIds);

        // 生成格式化输出
        const markdown = this.toMarkdown(nodes, edges);
        const mermaid = this.toMermaid(nodes, edges);

        return {
            nodes,
            edges,
            markdown,
            mermaid,
        };
    }

    // ========== 辅助方法 ==========

    /**
     * 获取节点类型标签
     */
    private static getNodeTypeLabel(node: ConvertedNode): string {
        if (node.type === 'file') {
            return node.isImage ? 'image' : 'file';
        }
        return node.type;
    }

    /**
     * 截断内容
     */
    private static truncateContent(content: string, maxLength: number): string {
        // 替换换行符为空格
        const singleLine = content.replace(/\n/g, ' ').trim();
        if (singleLine.length <= maxLength) {
            return singleLine;
        }
        return singleLine.slice(0, maxLength - 3) + '...';
    }

    /**
     * 清理 Mermaid 标签中的特殊字符
     * 注意：Mermaid 中方括号 [] 有特殊含义，需要转义
     * 使用 Unicode 全角方括号替代，保持可读性
     */
    private static sanitizeMermaidLabel(text: string): string {
        return text
            .replace(/"/g, "'")           // 双引号 -> 单引号
            .replace(/\[/g, '［')          // [ -> 全角左方括号
            .replace(/\]/g, '］')          // ] -> 全角右方括号
            .replace(/[<>]/g, '')          // 移除尖括号
            .replace(/[{}]/g, '')          // 移除花括号（菱形节点语法）
            .trim();
    }
}
