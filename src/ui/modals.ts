/**
 * UI Modals for Canvas AI Plugin
 * InputModal, ConfirmModal, DiffModal
 */

import { App, Modal } from 'obsidian';
import type { SelectionContext } from '../types';
import { t } from '../../lang/helpers';

// ========== Input Modal for Preset Names ==========
export class InputModal extends Modal {
    private result: string = '';
    private onSubmit: (result: string) => void;
    private title: string;
    private placeholder: string;
    private defaultValue: string;

    constructor(app: App, title: string, placeholder: string, defaultValue: string, onSubmit: (result: string) => void) {
        super(app);
        this.title = title;
        this.placeholder = placeholder;
        this.defaultValue = defaultValue;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h3', { text: this.title });

        const inputEl = contentEl.createEl('input', {
            type: 'text',
            placeholder: this.placeholder,
            value: this.defaultValue
        });
        inputEl.addClass('canvas-ai-modal-input');
        inputEl.addClass('canvas-ai-modal-input-full');

        this.result = this.defaultValue;

        inputEl.addEventListener('input', (e) => {
            this.result = (e.target as HTMLInputElement).value;
        });

        inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.close();
                if (this.result.trim()) {
                    this.onSubmit(this.result.trim());
                }
            }
        });

        const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });

        const cancelBtn = buttonContainer.createEl('button', { text: t('Cancel') });
        cancelBtn.addEventListener('click', () => this.close());

        const submitBtn = buttonContainer.createEl('button', { text: t('OK'), cls: 'mod-cta' });
        submitBtn.addEventListener('click', () => {
            this.close();
            if (this.result.trim()) {
                this.onSubmit(this.result.trim());
            }
        });

        // Focus input
        setTimeout(() => inputEl.focus(), 50);
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

// ========== Confirm Modal for Delete ==========
export class ConfirmModal extends Modal {
    private onConfirm: () => void;
    private message: string;

    constructor(app: App, message: string, onConfirm: () => void) {
        super(app);
        this.message = message;
        this.onConfirm = onConfirm;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h3', { text: t('Confirm Delete') });
        contentEl.createEl('p', { text: this.message });

        const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });

        const cancelBtn = buttonContainer.createEl('button', { text: t('Cancel') });
        cancelBtn.addEventListener('click', () => this.close());

        const deleteBtn = buttonContainer.createEl('button', { text: t('Delete'), cls: 'mod-warning' });
        deleteBtn.addEventListener('click', () => {
            this.close();
            this.onConfirm();
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

// ========== Line Diff Algorithm ==========
interface DiffLine {
    type: 'unchanged' | 'added' | 'removed';
    text: string;
}

// 使用 LCS (Longest Common Subsequence) 算法计算行级差异
function computeLineDiff(oldText: string, newText: string): { oldLines: DiffLine[]; newLines: DiffLine[] } {
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');

    // 构建 LCS 表
    const m = oldLines.length;
    const n = newLines.length;
    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (oldLines[i - 1] === newLines[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    // 回溯得到 diff
    let i = m, j = n;

    const oldDiff: DiffLine[] = [];
    const newDiff: DiffLine[] = [];

    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
            oldDiff.unshift({ type: 'unchanged', text: oldLines[i - 1] });
            newDiff.unshift({ type: 'unchanged', text: newLines[j - 1] });
            i--; j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            newDiff.unshift({ type: 'added', text: newLines[j - 1] });
            j--;
        } else if (i > 0) {
            oldDiff.unshift({ type: 'removed', text: oldLines[i - 1] });
            i--;
        }
    }

    return { oldLines: oldDiff, newLines: newDiff };
}

// 渲染 diff 行到 HTML 元素
function renderDiffLines(lines: DiffLine[], container: HTMLElement): void {
    lines.forEach(line => {
        const lineEl = container.createEl('div', { cls: `diff-line diff-${line.type}` });
        lineEl.setText(line.text || ' '); // 空行显示空格以保持高度
    });
}

// ========== Diff Modal for Edit Review ==========
export class DiffModal extends Modal {
    private context: SelectionContext;
    private replacementText: string;
    private onConfirm: () => void | Promise<void>;
    private onCancel: () => void;

    constructor(app: App, context: SelectionContext, replacementText: string, onConfirm: () => void | Promise<void>, onCancel: () => void) {
        super(app);
        this.context = context;
        this.replacementText = replacementText;
        this.onConfirm = onConfirm;
        this.onCancel = onCancel;
    }

    onOpen() {
        const { contentEl } = this;
        this.modalEl.addClass('canvas-ai-diff-modal');
        contentEl.createEl('h2', { text: t('Review changes') });

        const container = contentEl.createDiv({ cls: 'diff-container' });

        // 判断是否为全文修改场景（preText 和 postText 都为空）
        const isFullTextMode = !this.context.preText && !this.context.postText;

        if (isFullTextMode) {
            // 全文模式：使用行级 diff 算法
            const { oldLines, newLines } = computeLineDiff(
                this.context.selectedText,
                this.replacementText
            );

            const createDiffBox = (title: string, lines: DiffLine[], type: 'original' | 'new') => {
                const box = container.createDiv({ cls: `diff-box ${type}` });
                box.createEl('h3', { text: title });
                const pre = box.createEl('pre', { cls: 'diff-pre-lines' });
                renderDiffLines(lines, pre);
            };

            createDiffBox(t('Before'), oldLines, 'original');
            createDiffBox(t('After'), newLines, 'new');
        } else {
            // 选区模式：使用原有逻辑
            const createBox = (title: string, content: HTMLElement, type: 'original' | 'new') => {
                const box = container.createDiv({ cls: `diff-box ${type}` });
                box.createEl('h3', { text: title });
                const pre = box.createEl('pre');
                pre.appendChild(content);
            };

            // Original View: Pre + Highlighted(Red) Selected + Post
            const originalContent = document.createElement('span');
            originalContent.createSpan({ text: this.context.preText });
            const removedSpan = originalContent.createSpan({ cls: 'diff-remove' });
            removedSpan.setText(this.context.selectedText);
            originalContent.createSpan({ text: this.context.postText });

            // New View: Pre + Highlighted(Green) Replacement + Post
            const newContent = document.createElement('span');
            newContent.createSpan({ text: this.context.preText });
            const addedSpan = newContent.createSpan({ cls: 'diff-add' });
            addedSpan.setText(this.replacementText);
            newContent.createSpan({ text: this.context.postText });

            createBox(t('Before'), originalContent, 'original');
            createBox(t('After'), newContent, 'new');
        }

        const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });

        const cancelBtn = buttonContainer.createEl('button', { text: t('Cancel') });
        cancelBtn.addEventListener('click', () => {
            this.onCancel();
            this.close();
        });

        const confirmBtn = buttonContainer.createEl('button', { text: t('Apply'), cls: 'mod-cta' });
        confirmBtn.addEventListener('click', () => {
            void this.onConfirm();
            this.close();
        });

        // Auto-scroll to first change
        setTimeout(() => {
            const boxes = container.querySelectorAll('.diff-box');
            boxes.forEach(box => {
                const isOriginal = box.classList.contains('original');
                const selector = isOriginal ? '.diff-removed, .diff-remove' : '.diff-added, .diff-add';
                const changeEl = box.querySelector(selector);
                
                if (changeEl) {
                    changeEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
                }
            });
        }, 300);
    }

    onClose() {
        this.contentEl.empty();
    }
}
