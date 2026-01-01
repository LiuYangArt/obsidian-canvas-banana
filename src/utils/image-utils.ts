/**
 * 图片工具函数 - 共享于 Notes 和 Sidebar 模块
 */

import { App, TFile, Vault } from 'obsidian';
import { CanvasConverter } from '../canvas/canvas-converter';
import type { CanvasAISettings } from '../settings/settings';

/**
 * 生成唯一 ID
 */
export function generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 11);
}

/**
 * 解析图片路径（相对于文件所在目录或 vault 根目录）
 */
export function resolveImagePath(app: App, filePath: string, imgPath: string): string | null {
    // 先尝试从 vault 根目录查找
    const file = app.vault.getAbstractFileByPath(imgPath);
    if (file) {
        return imgPath;
    }

    // 尝试相对于文件所在目录
    const fileDir = filePath.substring(0, filePath.lastIndexOf('/'));
    const relativePath = fileDir ? `${fileDir}/${imgPath}` : imgPath;
    const relativeFile = app.vault.getAbstractFileByPath(relativePath);
    if (relativeFile) {
        return relativePath;
    }

    return null;
}

/**
 * 提取文档中的内嵌图片 ![[image.png]] 并读取为 base64
 */
export async function extractDocumentImages(
    app: App,
    content: string,
    filePath: string,
    settings: CanvasAISettings
): Promise<{ base64: string; mimeType: string; type: 'image' }[]> {
    const images: { base64: string; mimeType: string; type: 'image' }[] = [];

    // 解析 ![[image.png]] 语法
    const regex = /!\[\[([^\]]+\.(png|jpg|jpeg|gif|webp|svg|bmp))\]\]/gi;
    const matches: string[] = [];
    let match;
    while ((match = regex.exec(content)) !== null) {
        matches.push(match[1]);
    }

    if (matches.length === 0) {
        return images;
    }

    const MAX_IMAGES = 14;

    for (const imgPath of matches) {
        if (images.length >= MAX_IMAGES) {
            console.debug(`Image Utils: Image limit (${MAX_IMAGES}) reached, skipping remaining`);
            break;
        }

        // 解析图片路径
        const resolvedPath = resolveImagePath(app, filePath, imgPath);
        if (!resolvedPath) continue;

        try {
            const imgData = await CanvasConverter.readSingleImageFile(
                app,
                resolvedPath,
                settings.imageCompressionQuality,
                settings.imageMaxSize
            );
            if (imgData) {
                images.push({
                    base64: imgData.base64,
                    mimeType: imgData.mimeType,
                    type: 'image'
                });
            }
        } catch (e) {
            console.warn('Image Utils: Failed to read embedded image:', imgPath, e);
        }
    }

    return images;
}

/**
 * 保存生成的图片到 vault（与当前文件相同目录）
 */
export async function saveImageToVault(
    vault: Vault,
    base64DataUrl: string,
    currentFile: TFile
): Promise<string> {
    const timestamp = Date.now();
    const fileName = `ai-generated-${timestamp}.png`;

    // 保存到与当前文件相同目录
    const folder = currentFile.parent?.path || '';
    const filePath = folder ? `${folder}/${fileName}` : fileName;

    // 转换 base64 并写入
    const base64 = base64DataUrl.replace(/^data:image\/\w+;base64,/, '');
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }

    await vault.createBinary(filePath, bytes.buffer);
    return fileName;
}
