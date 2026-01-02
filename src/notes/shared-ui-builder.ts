/**
 * Shared UI Builder
 * 悬浮面板和侧栏共用的 UI 构建器和常量
 */

import { setIcon } from 'obsidian';
import { PromptPreset, QuickSwitchModel } from '../settings/settings';
import { t } from '../../lang/helpers';
import { formatProviderName } from '../utils/format-utils';

// ========== 共享常量 ==========

export const RESOLUTION_OPTIONS = ['1K', '2K', '4K'];
export const ASPECT_RATIO_OPTIONS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];

// ========== 共享 DOM 构建器 ==========

export interface TabsElements {
    container: HTMLElement;
    editBtn: HTMLButtonElement;
    imageBtn: HTMLButtonElement;
}

export function createTabs(parent: HTMLElement): TabsElements {
    const container = parent.createDiv('canvas-ai-tabs');
    const editBtn = container.createEl('button', { cls: 'canvas-ai-tab active', text: t('Edit') });
    const imageBtn = container.createEl('button', { cls: 'canvas-ai-tab', text: t('Image') });
    return { container, editBtn, imageBtn };
}

export interface PresetRowElements {
    container: HTMLElement;
    select: HTMLSelectElement;
    addBtn: HTMLButtonElement;
    deleteBtn: HTMLButtonElement;
    saveBtn: HTMLButtonElement;
    renameBtn: HTMLButtonElement;
}

export function createPresetRow(parent: HTMLElement): PresetRowElements {
    const container = parent.createDiv('canvas-ai-preset-row');
    const select = container.createEl('select', 'canvas-ai-preset-select dropdown');
    select.createEl('option', { value: '', text: t('Select prompt preset') });

    const actions = container.createDiv('canvas-ai-preset-actions');

    const createBtn = (action: string, titleText: string, icon: string): HTMLButtonElement => {
        const btn = actions.createEl('button', {
            cls: 'canvas-ai-preset-btn',
            attr: { 'data-action': action, 'title': titleText }
        });
        setIcon(btn, icon);
        return btn;
    };

    return {
        container,
        select,
        addBtn: createBtn('add', t('New Preset'), 'circle-plus'),
        deleteBtn: createBtn('delete', t('Delete'), 'circle-x'),
        saveBtn: createBtn('save', t('Save'), 'save'),
        renameBtn: createBtn('rename', t('Rename Preset'), 'book-a')
    };
}

export interface ModelSelectElements {
    container: HTMLElement;
    select: HTMLSelectElement;
}

export function createModelSelectRow(parent: HTMLElement, labelText: string): ModelSelectElements {
    const container = parent.createDiv('canvas-ai-option-row canvas-ai-model-select-row');
    const group = container.createEl('span', 'canvas-ai-option-group');
    group.createEl('label', { text: labelText });
    const select = group.createEl('select', 'dropdown');
    return { container, select };
}

export interface ImageOptionsElements {
    container: HTMLElement;
    resolutionSelect: HTMLSelectElement;
    aspectRatioSelect: HTMLSelectElement;
    modelSelect: HTMLSelectElement;
}

export function createImageOptionsRow(parent: HTMLElement): ImageOptionsElements {
    const container = parent.createDiv('canvas-ai-image-options is-hidden');

    // Resolution & Ratio row
    const row1 = container.createDiv('canvas-ai-option-row');

    const resGrp = row1.createEl('span', 'canvas-ai-option-group');
    resGrp.createEl('label', { text: t('Resolution') });
    const resolutionSelect = resGrp.createEl('select', 'dropdown');
    RESOLUTION_OPTIONS.forEach(res => {
        resolutionSelect.createEl('option', { value: res, text: res });
    });

    const ratioGrp = row1.createEl('span', 'canvas-ai-option-group');
    ratioGrp.createEl('label', { text: t('Ratio') });
    const aspectRatioSelect = ratioGrp.createEl('select', 'dropdown');
    ASPECT_RATIO_OPTIONS.forEach(ratio => {
        aspectRatioSelect.createEl('option', { value: ratio, text: ratio });
    });

    // Model row
    const { select: modelSelect } = createModelSelectRow(container, t('Palette Model'));

    return { container, resolutionSelect, aspectRatioSelect, modelSelect };
}

// ========== 共享业务逻辑 ==========

/**
 * 刷新 Preset 下拉框
 */
export function refreshPresetSelect(select: HTMLSelectElement, presets: PromptPreset[]): void {
    select.empty();
    select.createEl('option', { value: '', text: t('Select prompt preset') });
    presets.forEach(preset => {
        select.createEl('option', { value: preset.id, text: preset.name });
    });
}

/**
 * 更新模型下拉框
 */
export function updateModelSelect(
    select: HTMLSelectElement,
    models: QuickSwitchModel[],
    selectedModel: string
): string {
    select.empty();

    models.forEach(model => {
        const key = `${model.provider}|${model.modelId}`;
        const displayName = `${model.displayName || model.modelId} | ${formatProviderName(model.provider)}`;
        select.createEl('option', { value: key, text: displayName });
    });

    if (selectedModel && select.querySelector(`option[value="${selectedModel}"]`)) {
        select.value = selectedModel;
        return selectedModel;
    } else if (models.length > 0) {
        const firstKey = `${models[0].provider}|${models[0].modelId}`;
        select.value = firstKey;
        return firstKey;
    }
    return '';
}

/**
 * 设置键盘事件阻止冒泡
 */
export function setupKeyboardIsolation(el: HTMLElement): void {
    const stopPropagation = (e: Event) => e.stopPropagation();
    el.addEventListener('keydown', stopPropagation, { capture: true });
    el.addEventListener('keyup', stopPropagation);
    el.addEventListener('keypress', stopPropagation);
}
