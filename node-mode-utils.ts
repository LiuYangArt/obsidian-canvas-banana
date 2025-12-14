/**
 * Node Mode utility functions
 * Handles JSON extraction, validation, and coordinate remapping
 * for LLM-generated Canvas JSON structures
 */

// ========== Type Definitions ==========

export interface CanvasJsonNode {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    type: 'text' | 'group' | 'link';
    text?: string;
    label?: string;
    url?: string;
    color?: string;
}

export interface CanvasJsonEdge {
    id: string;
    fromNode: string;
    toNode: string;
    fromSide?: 'top' | 'right' | 'bottom' | 'left';
    toSide?: 'top' | 'right' | 'bottom' | 'left';
    fromEnd?: 'arrow';
    toEnd?: 'arrow';
    color?: string;
    label?: string;
}

export interface CanvasData {
    nodes: CanvasJsonNode[];
    edges: CanvasJsonEdge[];
}

// ========== JSON Extraction ==========

/**
 * Extract Canvas JSON from LLM response
 * Handles multiple formats:
 * - Raw JSON string
 * - JSON wrapped in ```json code blocks
 * - JSON with text before/after
 */
export function extractCanvasJSON(response: string): CanvasData {
    let jsonStr = response.trim();

    // Try to extract from markdown code block
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1].trim();
    } else {
        // Find first { and last } to extract JSON object
        const firstBrace = jsonStr.indexOf('{');
        const lastBrace = jsonStr.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
        }
    }

    // Parse JSON
    let data: any;
    try {
        data = JSON.parse(jsonStr);
    } catch (e: any) {
        throw new Error(`JSON parse error: ${e.message}`);
    }

    return validateCanvasData(data);
}

// ========== Validation ==========

/**
 * Validate and normalize Canvas data structure
 * Ensures nodes array exists and each node has required fields
 */
export function validateCanvasData(data: any): CanvasData {
    if (!data || typeof data !== 'object') {
        throw new Error('Invalid JSON: not an object');
    }

    if (!Array.isArray(data.nodes)) {
        throw new Error('Invalid structure: missing nodes array');
    }

    // Allow empty edges
    if (!Array.isArray(data.edges)) {
        data.edges = [];
    }

    // Validate each node has required fields
    for (let i = 0; i < data.nodes.length; i++) {
        const node = data.nodes[i];
        if (!node.id) {
            throw new Error(`Node ${i}: missing id`);
        }
        if (node.x === undefined || node.y === undefined) {
            throw new Error(`Node ${i}: missing x/y coordinates`);
        }
        if (!node.width || !node.height) {
            throw new Error(`Node ${i}: missing width/height`);
        }
        if (!node.type) {
            // Default to text type if missing
            node.type = 'text';
        }
    }

    // Validate edges reference existing nodes
    const nodeIds = new Set(data.nodes.map((n: any) => n.id));
    for (let i = 0; i < data.edges.length; i++) {
        const edge = data.edges[i];
        if (!edge.id) {
            throw new Error(`Edge ${i}: missing id`);
        }
        if (!edge.fromNode || !edge.toNode) {
            throw new Error(`Edge ${i}: missing fromNode/toNode`);
        }
        if (!nodeIds.has(edge.fromNode)) {
            console.warn(`Edge ${i}: fromNode "${edge.fromNode}" not found in nodes`);
        }
        if (!nodeIds.has(edge.toNode)) {
            console.warn(`Edge ${i}: toNode "${edge.toNode}" not found in nodes`);
        }
    }

    return data as CanvasData;
}

// ========== Sanitization (Post-processing) ==========

/**
 * Sanitize Canvas data by removing invalid/empty nodes and edges
 * This is a defensive post-processing step to clean up LLM output
 * 
 * @param data Canvas data to sanitize
 * @param removeOrphanNodes If true, remove nodes without any edge connections (default: true)
 * @returns Sanitized canvas data with counts of removed items
 */
export function sanitizeCanvasData(
    data: CanvasData,
    removeOrphanNodes: boolean = true
): { data: CanvasData; stats: { removedEmptyNodes: number; removedOrphanNodes: number; removedInvalidEdges: number } } {
    const stats = {
        removedEmptyNodes: 0,
        removedOrphanNodes: 0,
        removedInvalidEdges: 0
    };

    // Step 1: Filter out empty text nodes (nodes with no or whitespace-only text)
    const nodesAfterEmptyFilter = data.nodes.filter(node => {
        if (node.type === 'text') {
            const hasContent = node.text && node.text.trim().length > 0;
            if (!hasContent) {
                stats.removedEmptyNodes++;
                console.warn(`Canvas AI Sanitize: Removed empty text node "${node.id}"`);
                return false;
            }
        }
        // Keep non-text nodes (group, link) and text nodes with content
        return true;
    });

    // Step 2: Build set of valid node IDs after empty node removal
    const validNodeIds = new Set(nodesAfterEmptyFilter.map(n => n.id));

    // Step 3: Filter out edges that reference non-existent nodes
    const validEdges = data.edges.filter(edge => {
        const fromExists = validNodeIds.has(edge.fromNode);
        const toExists = validNodeIds.has(edge.toNode);
        if (!fromExists || !toExists) {
            stats.removedInvalidEdges++;
            console.warn(`Canvas AI Sanitize: Removed invalid edge "${edge.id}" (fromNode: ${edge.fromNode} exists: ${fromExists}, toNode: ${edge.toNode} exists: ${toExists})`);
            return false;
        }
        return true;
    });

    // Step 4: Optionally filter out orphan nodes (nodes without any edge connections)
    let finalNodes = nodesAfterEmptyFilter;
    if (removeOrphanNodes && validEdges.length > 0) {
        // Build set of nodes that are connected by at least one edge
        const connectedNodeIds = new Set<string>();
        for (const edge of validEdges) {
            connectedNodeIds.add(edge.fromNode);
            connectedNodeIds.add(edge.toNode);
        }

        finalNodes = nodesAfterEmptyFilter.filter(node => {
            // Keep group nodes even if orphaned (they may contain other nodes conceptually)
            if (node.type === 'group') {
                return true;
            }
            const isConnected = connectedNodeIds.has(node.id);
            if (!isConnected) {
                stats.removedOrphanNodes++;
                console.warn(`Canvas AI Sanitize: Removed orphan node "${node.id}" (text: "${node.text?.substring(0, 30)}...")`);
                return false;
            }
            return true;
        });
    } else if (removeOrphanNodes && validEdges.length === 0 && nodesAfterEmptyFilter.length > 1) {
        // Special case: if no edges at all but multiple nodes, keep all (might be intentional list)
        console.warn('Canvas AI Sanitize: No edges present, keeping all nodes as potential intentional structure');
    }

    return {
        data: {
            nodes: finalNodes,
            edges: validEdges
        },
        stats
    };
}

// ========== Coordinate Remapping ==========

/**
 * Remap coordinates to center the generated structure on target position
 * Implements the algorithm from node_mode.md Section 3.4
 * 
 * @param data Canvas data with nodes and edges
 * @param targetCenter The center point where the structure should be placed
 * @returns Modified canvas data with remapped coordinates
 */
export function remapCoordinates(
    data: CanvasData,
    targetCenter: { x: number; y: number }
): CanvasData {
    if (data.nodes.length === 0) return data;

    // 1. Calculate bounding box of generated data
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    for (const node of data.nodes) {
        minX = Math.min(minX, node.x);
        minY = Math.min(minY, node.y);
        maxX = Math.max(maxX, node.x + node.width);
        maxY = Math.max(maxY, node.y + node.height);
    }

    // 2. Calculate center of generated data
    const generatedCenterX = minX + (maxX - minX) / 2;
    const generatedCenterY = minY + (maxY - minY) / 2;

    // 3. Calculate offset = target - generated center
    const deltaX = targetCenter.x - generatedCenterX;
    const deltaY = targetCenter.y - generatedCenterY;

    // 4. Apply offset to all nodes
    for (const node of data.nodes) {
        node.x += deltaX;
        node.y += deltaY;
    }

    return data;
}

// ========== ID Regeneration ==========

/**
 * Generate a UUIDv4 string
 */
function generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * Regenerate unique UUIDs for all nodes and edges
 * Also updates edge references to use new node IDs
 * This prevents ID collision with existing canvas elements
 * 
 * @param data Canvas data to process
 * @returns Modified canvas data with new unique IDs
 */
export function regenerateIds(data: CanvasData): CanvasData {
    const idMap = new Map<string, string>();

    // Regenerate node IDs
    for (const node of data.nodes) {
        const newId = generateUUID();
        idMap.set(node.id, newId);
        node.id = newId;
    }

    // Regenerate edge IDs and update node references
    for (const edge of data.edges) {
        edge.id = generateUUID();

        // Update fromNode and toNode to use new IDs
        const newFromNode = idMap.get(edge.fromNode);
        const newToNode = idMap.get(edge.toNode);

        if (newFromNode) {
            edge.fromNode = newFromNode;
        }
        if (newToNode) {
            edge.toNode = newToNode;
        }
    }

    return data;
}

// ========== Layout Optimization ==========

/**
 * Estimate node dimensions based on text content
 * Uses character count and line breaks to estimate appropriate size
 */
function estimateNodeSize(text: string | undefined): { width: number; height: number } {
    if (!text) {
        return { width: 200, height: 100 };
    }

    // Configuration
    const charWidth = 12;  // Approximate pixels per character
    const lineHeight = 24; // Approximate pixels per line
    const padding = 40;    // Padding for borders/margins
    const minWidth = 200;
    const maxWidth = 500;
    const minHeight = 80;
    const maxHeight = 400;

    // Calculate based on content
    const lines = text.split('\n');
    const maxLineLength = Math.max(...lines.map(l => l.length), 10);

    // Estimate width based on longest line
    let estimatedWidth = maxLineLength * charWidth + padding;
    estimatedWidth = Math.max(minWidth, Math.min(maxWidth, estimatedWidth));

    // Estimate height based on line count and text wrapping
    const avgCharsPerLine = Math.floor((estimatedWidth - padding) / charWidth);
    let totalLines = 0;
    for (const line of lines) {
        totalLines += Math.ceil(Math.max(line.length, 1) / avgCharsPerLine);
    }

    let estimatedHeight = totalLines * lineHeight + padding;
    estimatedHeight = Math.max(minHeight, Math.min(maxHeight, estimatedHeight));

    return { width: estimatedWidth, height: estimatedHeight };
}

/**
 * Check if two nodes overlap
 */
function nodesOverlap(
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number },
    gap: number = 30
): boolean {
    return !(
        a.x + a.width + gap < b.x ||
        b.x + b.width + gap < a.x ||
        a.y + a.height + gap < b.y ||
        b.y + b.height + gap < a.y
    );
}

/**
 * Optimize layout by adjusting node sizes based on text content
 * and spreading nodes apart to avoid overlap
 * 
 * @param data Canvas data to optimize
 * @returns Optimized canvas data
 */
export function optimizeLayout(data: CanvasData): CanvasData {
    if (data.nodes.length === 0) return data;

    const gap = 50; // Minimum gap between nodes

    // Step 1: Adjust node sizes based on text content
    for (const node of data.nodes) {
        if (node.type === 'text' && node.text) {
            const estimated = estimateNodeSize(node.text);
            // Use estimated size if it's significantly different from LLM suggested size
            if (estimated.width > node.width * 1.2 || estimated.height > node.height * 1.3) {
                node.width = estimated.width;
                node.height = estimated.height;
            }
        }
    }

    // Step 2: Detect and resolve overlaps using simple force-based spreading
    const maxIterations = 50;
    for (let iteration = 0; iteration < maxIterations; iteration++) {
        let hasOverlap = false;

        for (let i = 0; i < data.nodes.length; i++) {
            for (let j = i + 1; j < data.nodes.length; j++) {
                const nodeA = data.nodes[i];
                const nodeB = data.nodes[j];

                if (nodesOverlap(nodeA, nodeB, gap)) {
                    hasOverlap = true;

                    // Calculate centers
                    const centerAx = nodeA.x + nodeA.width / 2;
                    const centerAy = nodeA.y + nodeA.height / 2;
                    const centerBx = nodeB.x + nodeB.width / 2;
                    const centerBy = nodeB.y + nodeB.height / 2;

                    // Calculate direction vector from A to B
                    let dx = centerBx - centerAx;
                    let dy = centerBy - centerAy;

                    // Handle identical positions
                    if (dx === 0 && dy === 0) {
                        dx = 1;
                        dy = 0;
                    }

                    // Normalize and scale the push distance
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    const pushDistance = gap / 2;
                    const pushX = (dx / distance) * pushDistance;
                    const pushY = (dy / distance) * pushDistance;

                    // Push nodes apart (each moves half the distance)
                    nodeA.x -= pushX;
                    nodeA.y -= pushY;
                    nodeB.x += pushX;
                    nodeB.y += pushY;
                }
            }
        }

        if (!hasOverlap) break;
    }

    return data;
}
