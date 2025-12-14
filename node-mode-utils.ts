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
