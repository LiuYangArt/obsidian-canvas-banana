/**
 * Canvas 工具函数模块
 * 提供 Canvas 操作的辅助函数
 */

import { Notice } from 'obsidian';
import type { Canvas, CanvasNode } from '../types';
import { t } from '../../lang/helpers';

// 支持的图片扩展名列表
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'];

/**
 * 获取选中的图片节点（仅当单选图片时）
 */
export function getSelectedImageNode(canvas: Canvas | null): CanvasNode | null {
    if (!canvas || canvas.selection.size !== 1) return null;
    const node = Array.from(canvas.selection)[0];
    if (!node.file) return null;
    const ext = node.file.extension?.toLowerCase();
    if (IMAGE_EXTENSIONS.includes(ext)) {
        return node;
    }
    return null;
}

/**
 * 匹配键盘事件与快捷键字符串（如 "Alt+C"）
 */
export function matchesHotkey(evt: KeyboardEvent, hotkey: string): boolean {
    if (!hotkey) return false;
    const parts = hotkey.toLowerCase().split('+');
    const key = parts[parts.length - 1];
    const needCtrl = parts.includes('ctrl');
    const needShift = parts.includes('shift');
    const needAlt = parts.includes('alt');

    return evt.key.toLowerCase() === key &&
        evt.ctrlKey === needCtrl &&
        evt.shiftKey === needShift &&
        evt.altKey === needAlt;
}

/**
 * 从文件扩展名获取 MIME 类型
 */
export function getMimeType(ext: string): string {
    const map: Record<string, string> = {
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'gif': 'image/gif',
        'webp': 'image/webp',
        'svg': 'image/svg+xml',
        'bmp': 'image/bmp'
    };
    return map[ext.toLowerCase()] || 'image/png';
}

/**
 * 使用 Canvas API 将图片 Blob 转换为 PNG
 */
export async function convertToPng(blob: Blob): Promise<Blob> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                reject(new Error('Failed to get canvas context'));
                return;
            }
            ctx.drawImage(img, 0, 0);
            canvas.toBlob((pngBlob) => {
                URL.revokeObjectURL(img.src);
                if (pngBlob) {
                    resolve(pngBlob);
                } else {
                    reject(new Error('Failed to convert to PNG'));
                }
            }, 'image/png');
        };
        img.onerror = () => {
            URL.revokeObjectURL(img.src);
            reject(new Error('Failed to load image'));
        };
        img.src = URL.createObjectURL(blob);
    });
}

/**
 * 从选中的节点创建分组
 */
export function createGroupFromSelection(canvas: Canvas): void {
    try {
        const selection = canvas.selection;
        if (selection.size === 0) return;

        // 计算选中节点的包围盒
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        selection.forEach((node: CanvasNode) => {
            minX = Math.min(minX, node.x);
            minY = Math.min(minY, node.y);
            maxX = Math.max(maxX, node.x + node.width);
            maxY = Math.max(maxY, node.y + node.height);
        });

        // 添加边距
        const padding = 20;
        const groupX = minX - padding;
        const groupY = minY - padding;
        const groupWidth = (maxX - minX) + padding * 2;
        const groupHeight = (maxY - minY) + padding * 2;

        // 使用 Canvas 内部 API 创建分组节点
        if (typeof canvas.createGroupNode === 'function') {
            const groupNode = canvas.createGroupNode({
                pos: { x: groupX, y: groupY },
                size: { width: groupWidth, height: groupHeight },
                label: '',
                save: true
            });

            // 将分组移到最底层
            if (groupNode && typeof groupNode.moveToBack === 'function') {
                groupNode.moveToBack();
            }

            canvas.requestSave();
            new Notice(t('Group created'));
        } else {
            // 备选方案：使用菜单方法
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
 * 获取视口中心的 Canvas 坐标
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
 * 在视口中心创建新的文本节点
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

        // 选中并开始编辑新节点
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

    // 获取所有需要选中的节点
    const nodesToSelect: CanvasNode[] = [];
    visited.forEach(nodeId => {
        const node = canvas.nodes.get(nodeId);
        if (node) {
            nodesToSelect.push(node);
        }
    });

    // 更新选择
    canvas.deselectAll();
    nodesToSelect.forEach(node => {
        canvas.select(node);
    });
}
