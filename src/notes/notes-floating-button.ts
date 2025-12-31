/**
 * Notes Floating Button
 * 在选中文字时显示的悬浮香蕉按钮
 */

import { setIcon, setTooltip } from 'obsidian';

export class NotesFloatingButton {
    private buttonEl: HTMLElement;
    private isVisible: boolean = false;
    private isGenerating: boolean = false;
    private onClick: (() => void) | null = null;

    constructor() {
        this.buttonEl = this.createButton();
        document.body.appendChild(this.buttonEl);
    }

    private createButton(): HTMLElement {
        const btn = document.createElement('button');
        btn.id = 'notes-ai-floating-button';
        btn.addClass('notes-ai-floating-button');
        btn.addClass('clickable-icon');
        btn.addClass('is-hidden');
        setIcon(btn, 'banana');
        setTooltip(btn, 'CanvasBanana', { placement: 'top' });

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            this.onClick?.();
        });

        // 阻止事件冒泡，避免触发编辑器行为
        btn.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            e.preventDefault();
        });

        return btn;
    }

    setOnClick(callback: () => void): void {
        this.onClick = callback;
    }

    show(x: number, y: number): void {
        this.buttonEl.style.left = `${x}px`;
        this.buttonEl.style.top = `${y}px`;
        this.buttonEl.removeClass('is-hidden');
        this.isVisible = true;
    }

    hide(): void {
        this.buttonEl.addClass('is-hidden');
        this.isVisible = false;
    }

    get visible(): boolean {
        return this.isVisible;
    }

    setGenerating(generating: boolean): void {
        this.isGenerating = generating;
        if (generating) {
            this.buttonEl.addClass('generating');
        } else {
            this.buttonEl.removeClass('generating');
        }
    }

    get generating(): boolean {
        return this.isGenerating;
    }

    getPosition(): { x: number; y: number } {
        const rect = this.buttonEl.getBoundingClientRect();
        return { x: rect.right, y: rect.top };
    }

    getElement(): HTMLElement {
        return this.buttonEl;
    }

    destroy(): void {
        this.buttonEl.remove();
    }
}
