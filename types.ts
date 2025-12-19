/**
 * Obsidian Canvas API 类型定义
 * 扩展 Obsidian 模块声明以支持 Canvas 相关操作
 */

import 'obsidian';
import { TFile, View, ItemView, Plugin, Menu, EventRef } from 'obsidian';

// Canvas 节点 ID 类型
export type CanvasNodeID = string;

export type CanvasEdgeID = string;

export interface CanvasJsonNode {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    type: 'text' | 'group' | 'link' | 'file';
    text?: string;
    label?: string;
    url?: string;
    color?: string;
    file?: string;
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

// Canvas 坐标系统
export interface CanvasCoords {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

// Canvas 节点基础接口
export interface CanvasNode {
    id: CanvasNodeID;
    x: number;
    y: number;
    width: number;
    height: number;
    zIndex: number;
    bbox: CanvasCoords;

    nodeEl: HTMLElement;
    contentEl: HTMLElement;
    containerEl: HTMLElement;

    canvas: Canvas;

    // 节点类型判断属性
    text?: string;      // 文本节点
    file?: TFile;       // 文件节点
    url?: string;       // 链接节点
    label?: string;     // 群组节点
    filePath?: string;  // 文件路径

    isEditing: boolean;

    getBBox(containing?: boolean): CanvasCoords;
    moveTo(pos: { x: number; y: number }): void;
    render(): void;
    startEditing(): void;
    setText?(text: string): void;
    resize?(size: { width: number; height: number }): void;
    moveToBack?(): void;
}

// Canvas 边接口
export interface CanvasEdge {
    id: CanvasEdgeID;
    from: {
        node: CanvasNode;
        side: 'left' | 'right' | 'top' | 'bottom';
    };
    to: {
        node: CanvasNode;
        side: 'left' | 'right' | 'top' | 'bottom';
    };
    canvas: Canvas;
    label?: string;
}

// Canvas 选中菜单
export interface CanvasMenu {
    containerEl: HTMLElement;
    menuEl: HTMLElement;
    canvas: Canvas;
    render(): void;
    updateZIndex(): void;
    groupNodes?(): void;
}

// Canvas 主接口
export interface Canvas {
    readonly: boolean;
    view: View;
    x: number;
    y: number;

    nodes: Map<CanvasNodeID, CanvasNode>;
    edges: Map<CanvasEdgeID, CanvasEdge>;
    selection: Set<CanvasNode>;

    menu: CanvasMenu;
    wrapperEl: HTMLElement;

    getData(): CanvasData;
    setData(data: CanvasData): void;
    requestSave(save?: boolean, triggerBySelf?: boolean): void;

    getEdgesForNode(node: CanvasNode): CanvasEdge[];
    getViewportNodes(): CanvasNode[];
    getContainingNodes(coords: CanvasCoords): CanvasNode[];

    deselectAll(): void;
    select(node: CanvasNode): void;
    selectOnly(node: CanvasNode): void;
    zoomToSelection(): void;

    // 节点创建方法
    createTextNode(options: {
        pos: { x: number; y: number; width: number; height: number };
        size: { x: number; y: number; width: number; height: number };
        text: string;
        focus?: boolean;
        save?: boolean;
    }): CanvasNode;

    addNode(node: CanvasNode): void;
    removeNode(node: CanvasNode): void;
    createFileNode(options: {
        file: TFile;
        pos: { x: number; y: number; width: number; height: number };
        size: { x: number; y: number; width: number; height: number };
        focus?: boolean;
        save?: boolean;
    }): CanvasNode;
    createGroupNode(options: {
        pos: { x: number; y: number };
        size?: { width: number; height: number };
        label?: string;
        focus?: boolean;
        save?: boolean;
    }): CanvasNode;
}

// Canvas 视图接口
export interface CanvasView extends ItemView {
    canvas: Canvas;
    file: TFile;
}

// 扩展 Obsidian 模块声明
declare module 'obsidian' {
    interface App {
        plugins: {
            getPlugin(name: string): Plugin | undefined;
        };
    }
    interface Workspace {
        on(name: 'canvas:node-menu', callback: (menu: Menu, node: CanvasNode) => void, ctx?: unknown): EventRef;
    }
}
