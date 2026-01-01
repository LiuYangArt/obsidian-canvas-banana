import { App, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import { t } from '../../lang/helpers';
import { CanvasAISettings } from '../settings/settings';

/**
 * 图片查看器模块
 * 处理图片在新窗口打开、复制到剪贴板等功能
 */

/**
 * Get MIME type from file extension
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
 * Convert image blob to PNG using Canvas API
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
 * Open image file in a new popout window
 * If singleWindowMode is enabled, reuse the existing popout window
 */
export async function openImageInNewWindow(
    app: App,
    file: TFile,
    settings: CanvasAISettings,
    imagePopoutLeaf: WorkspaceLeaf | null,
    setImagePopoutLeaf: (leaf: WorkspaceLeaf | null) => void
): Promise<void> {
    try {
        if (settings.singleWindowMode && imagePopoutLeaf) {
            // Check if the leaf is still valid (window not closed)
            const leaves = app.workspace.getLeavesOfType('image');
            const allLeaves = app.workspace.getLeavesOfType('');
            // Check if our tracked leaf still exists in workspace
            if (leaves.includes(imagePopoutLeaf) || allLeaves.includes(imagePopoutLeaf)) {
                await imagePopoutLeaf.openFile(file);
                return;
            }
        }
        // Create new popout window
        const leaf = app.workspace.openPopoutLeaf();
        await leaf.openFile(file);
        // Track the leaf for reuse
        if (settings.singleWindowMode) {
            setImagePopoutLeaf(leaf);
        }
    } catch (e) {
        console.error('Canvas Banana: Failed to open image in new window:', e);
    }
}

/**
 * Copy image to clipboard (converts to PNG if needed)
 */
export async function copyImageToClipboard(app: App, file: TFile): Promise<void> {
    try {
        const arrayBuffer = await app.vault.readBinary(file);
        const mimeType = getMimeType(file.extension);
        const blob = new Blob([arrayBuffer], { type: mimeType });

        // Clipboard API only supports PNG, convert if needed
        let pngBlob: Blob;
        if (file.extension.toLowerCase() === 'png') {
            pngBlob = blob;
        } else {
            pngBlob = await convertToPng(blob);
        }

        await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': pngBlob })
        ]);

        new Notice(t('Image copied'));
    } catch (error) {
        console.error('Canvas Banana: Failed to copy image:', error);
        new Notice(t('No image selected'));
    }
}
