/**
 * Mode Controller
 * 悬浮面板和侧栏共用的 Mode 切换控制器
 */

import { Notice } from 'obsidian';
import { t } from '../../lang/helpers';

export type PaletteMode = 'edit' | 'image' | 'text';

export interface ModeUIElements {
    editTabBtn: HTMLButtonElement | null;
    imageTabBtn: HTMLButtonElement | null;
    textTabBtn: HTMLButtonElement | null;
    editOptionsEl: HTMLElement | null;
    imageOptionsEl: HTMLElement | null;
    textOptionsEl: HTMLElement | null;
    promptInput: HTMLTextAreaElement | null;
}

export interface ModeControllerOptions {
    onModeChange?: (mode: PaletteMode) => void;
}

export class ModeController {
    private currentMode: PaletteMode = 'edit';
    private isEditBlocked: boolean = false;
    private isImageBlocked: boolean = false;
    private elements: ModeUIElements;
    private options: ModeControllerOptions;

    constructor(elements: ModeUIElements, options: ModeControllerOptions = {}) {
        this.elements = elements;
        this.options = options;
    }

    getMode(): PaletteMode {
        return this.currentMode;
    }

    /**
     * 用户点击切换 Tab (触发 onModeChange)
     */
    handleUserSwitch(mode: PaletteMode): boolean {
        if (this.switchInternal(mode)) {
            this.options.onModeChange?.(mode);
            return true;
        }
        return false;
    }

    /**
     * 外部程序切换 Tab (不触发 onModeChange)
     */
    setMode(mode: PaletteMode): boolean {
        return this.switchInternal(mode);
    }

    private switchInternal(mode: PaletteMode): boolean {
        // 如果 Edit 模式被禁用，阻止切换
        if (mode === 'edit' && this.isEditBlocked) {
            new Notice(t('Edit disabled during image generation'));
            return false;
        }

        // 如果 Image 模式被禁用，阻止切换
        if (mode === 'image' && this.isImageBlocked) {
            new Notice(t('Image disabled during edit generation'));
            return false;
        }

        // Text 模式永不阻塞

        if (this.currentMode === mode) return false;
        this.currentMode = mode;

        // 更新 Tab 状态
        const { editTabBtn, imageTabBtn, textTabBtn, editOptionsEl, imageOptionsEl, textOptionsEl, promptInput } = this.elements;

        if (editTabBtn && imageTabBtn) {
            editTabBtn.toggleClass('active', mode === 'edit');
            imageTabBtn.toggleClass('active', mode === 'image');
        }
        if (textTabBtn) {
            textTabBtn.toggleClass('active', mode === 'text');
        }

        // 更新 options 显示
        if (editOptionsEl && imageOptionsEl) {
            editOptionsEl.toggleClass('is-hidden', mode !== 'edit');
            imageOptionsEl.toggleClass('is-hidden', mode !== 'image');
        }
        if (textOptionsEl) {
            textOptionsEl.toggleClass('is-hidden', mode !== 'text');
        }

        // 更新 placeholder
        if (promptInput) {
            if (mode === 'edit') {
                promptInput.placeholder = t('Enter instructions');
            } else if (mode === 'image') {
                promptInput.placeholder = t('Describe the image');
            } else {
                promptInput.placeholder = t('Ask a question');
            }
        }

        return true;
    }

    setEditBlocked(blocked: boolean): void {
        this.isEditBlocked = blocked;
        if (this.elements.editTabBtn) {
            this.elements.editTabBtn.toggleClass('disabled', blocked);
        }
    }

    setImageBlocked(blocked: boolean): void {
        this.isImageBlocked = blocked;
        if (this.elements.imageTabBtn) {
            this.elements.imageTabBtn.toggleClass('disabled', blocked);
        }
    }

    isEditModeBlocked(): boolean {
        return this.isEditBlocked;
    }

    isImageModeBlocked(): boolean {
        return this.isImageBlocked;
    }
}
