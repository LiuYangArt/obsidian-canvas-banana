import { Notice } from 'obsidian';
import type { Canvas, CanvasNode } from '../types';
import { t } from '../../lang/helpers';

/**
 * 节点操作模块
 * 处理节点创建、分组、选择等操作
 */

/**
 * Get viewport center in canvas coordinates
 */
export function getViewportCenter(canvas: Canvas): { x: number; y: number } {
    const wrapperEl = canvas.wrapperEl;
    if (wrapperEl) {
        wrapperEl.getBoundingClientRect();
        return { x: canvas.x, y: canvas.y };
    }
    return { x: 0, y: 0 };
}

/**
 * Create a group from selected nodes
 */
export function createGroupFromSelection(canvas: Canvas): void {
    try {
        const selection = canvas.selection;
        if (selection.size === 0) return;

        // Calculate bounding box of selected nodes
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        selection.forEach((node: CanvasNode) => {
            minX = Math.min(minX, node.x);
            minY = Math.min(minY, node.y);
            maxX = Math.max(maxX, node.x + node.width);
            maxY = Math.max(maxY, node.y + node.height);
        });

        // Add padding around the group
        const padding = 20;
        const groupX = minX - padding;
        const groupY = minY - padding;
        const groupWidth = (maxX - minX) + padding * 2;
        const groupHeight = (maxY - minY) + padding * 2;

        // Create group node using Canvas internal API
        if (typeof canvas.createGroupNode === 'function') {
            const groupNode = canvas.createGroupNode({
                pos: { x: groupX, y: groupY },
                size: { width: groupWidth, height: groupHeight },
                label: '',
                save: true
            });

            // Move group to back (lower z-index)
            if (groupNode && typeof groupNode.moveToBack === 'function') {
                groupNode.moveToBack();
            }

            canvas.requestSave();
            new Notice(t('Group created'));
        } else {
            // Fallback: try using menu method
            if (canvas.menu && typeof canvas.menu.groupNodes === 'function') {
                canvas.menu.groupNodes();
                new Notice(t('Group created'));
            } else {
                console.warn('Canvas Banana: No group creation API available');
                new Notice('Group creation not available');
            }
        }
    } catch (e) {
        console.error('Canvas Banana: Failed to create group:', e);
    }
}

/**
 * Create a new text node at viewport center
 */
export function createNewNodeAtCenter(canvas: Canvas): void {
    try {
        const viewportCenter = getViewportCenter(canvas);

        const node = canvas.createTextNode({
            pos: { x: viewportCenter.x - 100, y: viewportCenter.y - 50, width: 200, height: 100 },
            size: { x: viewportCenter.x - 100, y: viewportCenter.y - 50, width: 200, height: 100 },
            text: '',
            focus: true,
            save: true
        });

        // Select and start editing the new node
        canvas.deselectAll();
        canvas.select(node);
        node.startEditing?.();

        new Notice(t('Node created'));
    } catch (e) {
        console.error('Canvas Banana: Failed to create new node:', e);
    }
}

/**
 * 选择连接的节点
 * @param canvas Canvas 实例
 * @param childOnly 如果为 true，只选择下游子节点；否则选择所有相连节点
 */
export function selectConnectedNodes(canvas: Canvas, childOnly: boolean): void {
    const selection = canvas.selection;
    if (selection.size === 0) return;

    // 使用 BFS 遍历所有连接的节点
    const visited = new Set<string>();
    const queue: CanvasNode[] = [];

    // 初始化：将当前选中的节点加入队列
    selection.forEach(node => {
        visited.add(node.id);
        queue.push(node);
    });

    // BFS 遍历
    while (queue.length > 0) {
        const currentNode = queue.shift();
        if (!currentNode) continue;

        // 获取当前节点的所有边
        const edges = canvas.getEdgesForNode(currentNode);

        for (const edge of edges) {
            let targetNode: CanvasNode | undefined;

            if (childOnly) {
                // 只选择子节点：当前节点是 from 端时，to 端是子节点
                if (edge.from?.node?.id === currentNode.id && edge.to?.node) {
                    targetNode = edge.to.node;
                }
            } else {
                // 选择所有相连节点：双向都考虑
                if (edge.from?.node?.id === currentNode.id && edge.to?.node) {
                    targetNode = edge.to.node;
                } else if (edge.to?.node?.id === currentNode.id && edge.from?.node) {
                    targetNode = edge.from.node;
                }
            }

            // 如果找到新节点，加入队列
            if (targetNode && !visited.has(targetNode.id)) {
                visited.add(targetNode.id);
                queue.push(targetNode);
            }
        }
    }

    // 获取所有需要选中的节点（通过 ID 从 canvas.nodes 查找）
    const nodesToSelect: CanvasNode[] = [];
    visited.forEach(nodeId => {
        const node = canvas.nodes.get(nodeId);
        if (node) {
            nodesToSelect.push(node);
        }
    });

    // 更新选择：先取消全选，再逐个添加
    canvas.deselectAll();
    nodesToSelect.forEach(node => {
        canvas.select(node);
    });
}
