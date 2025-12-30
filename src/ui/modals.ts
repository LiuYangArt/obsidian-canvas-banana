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
        

        const createBox = (title: string, content: HTMLElement | string, type: 'original' | 'new') => {
            const box = container.createDiv({ cls: `diff-box ${type}` });
            box.createEl('h3', { text: title });
            const pre = box.createEl('pre');
            if (typeof content === 'string') {
                pre.setText(content);
            } else {
                pre.appendChild(content);
            }
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
    }

    onClose() {
        this.contentEl.empty();
    }
}
