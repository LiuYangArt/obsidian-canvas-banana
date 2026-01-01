import { App, ItemView, TFile } from 'obsidian';
import type { Canvas, CanvasNode, CanvasView, CanvasData } from '../types';

/**
 * Ghost Node 管理器
 * 处理 Ghost Node 的创建、更新和替换
 */
export class GhostNodeManager {
    private activeGhostNodeIds: Set<string> = new Set();
    private app: App;

    constructor(app: App) {
        this.app = app;
    }

    /**
     * Create a ghost node (loading placeholder)
     */
    createGhostNode(canvas: Canvas, x: number, y: number): CanvasNode {
        const node = canvas.createTextNode({
            pos: { x, y, width: 400, height: 100 },
            size: { x, y, width: 400, height: 100 },
            text: '🍌 AI Generating...',
            focus: false,
            save: true
        });

        // Track this ghost node to prevent race conditions
        this.activeGhostNodeIds.add(node.id);

        // Add ghost node styling
        if (node.nodeEl) {
            node.nodeEl.addClass('canvas-ai-ghost-node');
        }

        canvas.requestSave();
        return node;
    }

    /**
     * Update ghost node with response
     * Dynamically resize node height based on content length
     */
    updateGhostNode(node: CanvasNode, content: string, isError: boolean, keepTracking: boolean = false): void {
        // When updating ghost node to final state, remove from tracking
        if (!keepTracking) {
            this.activeGhostNodeIds.delete(node.id);
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

        // Fallback: directly set text property and re-render
        if (!((node as unknown as { setText?: (text: string) => void }).setText)) {
            (node as unknown as { text: string }).text = content;
            node.render?.();
        }

        // Dynamic height adjustment based on content
        const lines = content.split('\n');
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

    /**
     * Replace Ghost Node with real File Node (for images)
     */
    replaceGhostWithImageNode(canvas: Canvas, ghostNode: CanvasNode, file: TFile): void {
        const ghostNodeId = ghostNode.id;

        // Validate ghost node is still tracked
        if (!this.activeGhostNodeIds.has(ghostNodeId)) {
            console.warn(`Canvas Banana: Ghost node ${ghostNodeId} already replaced, skipping duplicate replacement`);
            return;
        }

        // Check if the ghost node still exists in the canvas
        const existingNode = canvas.nodes?.get(ghostNodeId);
        if (!existingNode) {
            console.warn(`Canvas Banana: Ghost node ${ghostNodeId} no longer exists in canvas, skipping`);
            this.activeGhostNodeIds.delete(ghostNodeId);
            return;
        }

        // Remove from tracking BEFORE replacement to prevent race conditions
        this.activeGhostNodeIds.delete(ghostNodeId);

        const { x, y, width } = ghostNode;
        const height = width;

        // Remove ghost
        canvas.removeNode(ghostNode);

        // Create file node
        canvas.createFileNode({
            file: file,
            pos: { x, y, width, height },
            size: { x, y, width, height },
            save: true,
            focus: false
        });

        canvas.requestSave();
        console.debug(`Canvas Banana: Replaced ghost node ${ghostNodeId} with image node`);
    }

    /**
     * Replace Ghost Node with Canvas data by directly modifying the .canvas file
     */
    async replaceGhostWithCanvasData(
        canvas: Canvas,
        ghostNode: CanvasNode,
        data: CanvasData,
        nodeDefaultColor?: string
    ): Promise<void> {
        const ghostNodeId = ghostNode.id;

        // Validate ghost node is still tracked
        if (!this.activeGhostNodeIds.has(ghostNodeId)) {
            console.warn(`Canvas Banana: Ghost node ${ghostNodeId} already replaced, skipping duplicate replacement (Node Mode)`);
            return;
        }

        // Check if the ghost node still exists in the canvas
        const existingNode = canvas.nodes?.get(ghostNodeId);
        if (!existingNode) {
            console.warn(`Canvas Banana: Ghost node ${ghostNodeId} no longer exists in canvas, skipping (Node Mode)`);
            this.activeGhostNodeIds.delete(ghostNodeId);
            return;
        }

        // Remove from tracking BEFORE replacement to prevent race conditions
        this.activeGhostNodeIds.delete(ghostNodeId);

        // Get the canvas file
        const canvasView = this.app.workspace.getActiveViewOfType(ItemView) as unknown as CanvasView | null;
        const canvasFile = canvasView?.file;

        if (!canvasFile || canvasFile.extension !== 'canvas') {
            throw new Error('Cannot find canvas file');
        }

        // Read current canvas data
        const fileContent = await this.app.vault.read(canvasFile);
        let canvasJson: { nodes: Record<string, unknown>[], edges: Record<string, unknown>[] };

        try {
            canvasJson = JSON.parse(fileContent);
        } catch {
            throw new Error('Failed to parse canvas file');
        }

        // Find and remove the ghost node from canvas data
        canvasJson.nodes = canvasJson.nodes.filter((n) => n.id !== ghostNodeId);

        // Add new nodes from LLM response
        const overrideColor = nodeDefaultColor || undefined;

        for (const node of data.nodes) {
            canvasJson.nodes.push({
                id: node.id,
                type: node.type,
                x: Math.round(node.x),
                y: Math.round(node.y),
                width: Math.round(node.width),
                height: Math.round(node.height),
                text: node.text,
                color: overrideColor || node.color,
                label: node.label,
                url: node.url
            });
        }

        // Add new edges from LLM response
        for (const edge of data.edges) {
            canvasJson.edges.push({
                id: edge.id,
                fromNode: edge.fromNode,
                toNode: edge.toNode,
                fromSide: edge.fromSide || 'right',
                toSide: edge.toSide || 'left',
                fromEnd: edge.fromEnd,
                toEnd: edge.toEnd,
                color: edge.color,
                label: edge.label
            });
        }

        // Write updated canvas data back to file
        await this.app.vault.modify(canvasFile, JSON.stringify(canvasJson, null, '\t'));

        // Trigger refresh
        setTimeout(() => {
            canvas.requestSave();
        }, 100);
    }

    /**
     * Check if a ghost node is still active (being tracked)
     */
    isGhostNodeActive(nodeId: string): boolean {
        return this.activeGhostNodeIds.has(nodeId);
    }
}
