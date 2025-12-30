/**
 * Ghost Node 操作模块
 * 处理 Canvas 中的占位节点创建、更新和替换
 */

import type { Canvas, CanvasNode } from '../types';

/**
 * 创建 Ghost Node（加载占位符）
 * @param canvas Canvas 实例
 * @param x X 坐标
 * @param y Y 坐标
 * @param activeGhostNodeIds 活动 Ghost Node ID 集合（用于跟踪）
 * @returns 创建的 CanvasNode
 */
export function createGhostNode(
    canvas: Canvas, 
    x: number, 
    y: number, 
    activeGhostNodeIds: Set<string>
): CanvasNode {
    const node = canvas.createTextNode({
        pos: { x, y, width: 400, height: 100 },
        size: { x, y, width: 400, height: 100 },
        text: '🍌 AI Generating...',
        focus: false,
        save: true
    });

    // Track this ghost node to prevent race conditions
    activeGhostNodeIds.add(node.id);

    // Add ghost node styling
    if (node.nodeEl) {
        node.nodeEl.addClass('canvas-ai-ghost-node');
    }

    canvas.requestSave();
    return node;
}

/**
 * 更新 Ghost Node 内容
 * 根据内容长度动态调整节点高度
 * @param node 要更新的节点
 * @param content 新内容
 * @param isError 是否为错误状态
 * @param activeGhostNodeIds 活动 Ghost Node ID 集合
 * @param keepTracking 是否保持跟踪（用于流式更新）
 */
export function updateGhostNode(
    node: CanvasNode, 
    content: string, 
    isError: boolean, 
    activeGhostNodeIds: Set<string>,
    keepTracking: boolean = false
): void {
    // When updating ghost node to final state, remove from tracking
    if (!keepTracking) {
        activeGhostNodeIds.delete(node.id);
    }

    // Remove ghost styling
    if (node.nodeEl) {
        node.nodeEl.removeClass('canvas-ai-ghost-node');
        if (isError) {
            node.nodeEl.addClass('canvas-ai-error-node');
        }
    }

    // Update node text content
    node.setText?.(content);

    // Alternative: directly set text property and re-render
    if (!((node as unknown as { setText?: (text: string) => void }).setText)) {
        (node as unknown as { text: string }).text = content;
        node.render?.();
    }

    // ========== Dynamic height adjustment ==========
    // Estimate height based on content:
    // - Count number of lines
    // - Consider average characters per line (approximately 50 chars at 400px width)
    const lines = content.split('\n');

    // Estimate wrapped lines for long lines
    let totalEstimatedLines = 0;
    const charsPerLine = 50;
    for (const line of lines) {
        const lineLen = line.length;
        if (lineLen === 0) {
            totalEstimatedLines += 1;
        } else {
            totalEstimatedLines += Math.ceil(lineLen / charsPerLine);
        }
    }

    // Calculate height: ~24px per line, minimum 100px, maximum 600px
    const lineHeight = 24;
    const padding = 40;
    const estimatedHeight = Math.min(
        Math.max(100, totalEstimatedLines * lineHeight + padding),
        600
    );

    // Update node dimensions
    if (node.resize) {
        node.resize({ width: 400, height: estimatedHeight });
    } else {
        node.width = 400;
        node.height = estimatedHeight;
    }

    node.canvas?.requestSave();
    console.debug(`Canvas Banana: Ghost Node updated, estimated ${totalEstimatedLines} lines, height: ${estimatedHeight}px`);
}
