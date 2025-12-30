/**
 * Global Entity Consistency Detector
 * 检测实体变更并提议全局更新
 */

import { App, Modal, Notice } from 'obsidian';
import { ApiManager } from '../api/api-manager';
import { t } from '../../lang/helpers';
import { applyPatches, TextChange, parseAIPatches } from './text-patcher';

export interface EntityChange {
    oldEntity: string;
    newEntity: string;
    occurrences: number;
    positions: number[];
}

export interface GlobalUpdateResult {
    hasChanges: boolean;
    entities: EntityChange[];
}

// AI 检测实体变更的 System Prompt
const ENTITY_DETECTION_PROMPT = `You are an entity change detector. Analyze the before/after text to identify if any named entities (person names, place names, product names, organization names, etc.) were renamed.

If you detect entity renaming, output JSON:
{
  "entities": [
    { "old": "OldName", "new": "NewName" }
  ]
}

If no entity renaming detected, output:
{ "entities": [] }

Only report clear entity renames, not general text changes.`;

// AI 生成全局替换的 System Prompt
const GLOBAL_REPLACE_PROMPT = `You are a text editor. Replace all occurrences of the specified entity with the new name.
Preserve the surrounding context and formatting.

Output a JSON array of changes:
[
  { "original": "exact text containing OldName", "new": "same text with NewName" }
]

Important:
- Include enough context around each occurrence for unique matching
- Maintain proper grammar and capitalization
- Handle possessives (Adam's -> David's)
- Handle plurals if applicable`;

/**
 * 检测文本修改中的实体变更
 */
export async function detectEntityChanges(
    apiManager: ApiManager,
    originalText: string,
    newText: string
): Promise<EntityChange[]> {
    const userMessage = `Before:\n\`\`\`\n${originalText}\n\`\`\`\n\nAfter:\n\`\`\`\n${newText}\n\`\`\``;

    try {
        const response = await apiManager.chatCompletion(
            userMessage,
            ENTITY_DETECTION_PROMPT,
            0 // temperature
        );

        console.debug('Entity Detection: AI response:', response);

        // 解析响应
        let content = response.trim();
        if (content.startsWith('```json')) content = content.slice(7);
        if (content.startsWith('```')) content = content.slice(3);
        if (content.endsWith('```')) content = content.slice(0, -3);
        content = content.trim();

        const parsed = JSON.parse(content);
        if (!parsed.entities || !Array.isArray(parsed.entities)) {
            console.debug('Entity Detection: No entities array in response');
            return [];
        }

        const result = parsed.entities.map((e: { old: string; new: string }) => ({
            oldEntity: e.old,
            newEntity: e.new,
            occurrences: 0,
            positions: []
        }));
        console.debug('Entity Detection: Parsed entities:', result);
        return result;
    } catch (error) {
        console.error('Entity detection failed:', error);
        return [];
    }
}

/**
 * 在文档中统计实体出现次数
 */
export function countEntityOccurrences(
    fullText: string,
    entity: string,
    excludeRange?: { start: number; end: number }
): { count: number; positions: number[] } {
    const positions: number[] = [];
    const regex = new RegExp(escapeRegex(entity), 'gi');
    let match;

    while ((match = regex.exec(fullText)) !== null) {
        const pos = match.index;
        // 排除已修改区域
        if (excludeRange && pos >= excludeRange.start && pos < excludeRange.end) {
            continue;
        }
        positions.push(pos);
    }

    return { count: positions.length, positions };
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 生成全局替换补丁
 */
export async function generateGlobalPatches(
    apiManager: ApiManager,
    fullText: string,
    oldEntity: string,
    newEntity: string
): Promise<TextChange[]> {
    const userMessage = `Full document:\n\`\`\`\n${fullText}\n\`\`\`\n\nReplace all occurrences of "${oldEntity}" with "${newEntity}".`;

    try {
        const response = await apiManager.chatCompletion(
            userMessage,
            GLOBAL_REPLACE_PROMPT,
            0
        );

        return parseAIPatches(response);
    } catch (error) {
        console.error('Failed to generate global patches:', error);
        return [];
    }
}

/**
 * Global Update Confirmation Modal
 * 询问用户是否应用全局实体更新
 */
export class GlobalUpdateModal extends Modal {
    private entities: EntityChange[];
    private onConfirm: (selectedEntities: EntityChange[]) => void | Promise<void>;
    private onCancel: () => void;
    private selectedEntities: Set<string> = new Set();

    constructor(
        app: App,
        entities: EntityChange[],
        onConfirm: (selectedEntities: EntityChange[]) => void | Promise<void>,
        onCancel: () => void
    ) {
        super(app);
        this.entities = entities;
        this.onConfirm = onConfirm;
        this.onCancel = onCancel;

        // 默认全选
        entities.forEach(e => this.selectedEntities.add(e.oldEntity));
    }

    onOpen(): void {
        const { contentEl } = this;
        this.modalEl.addClass('canvas-ai-global-update-modal');

        contentEl.createEl('h2', { text: t('Global entity update') });
        contentEl.createEl('p', {
            text: t('Found entity changes. Update all references?'),
            cls: 'global-update-description'
        });

        const listEl = contentEl.createDiv({ cls: 'global-update-list' });

        for (const entity of this.entities) {
            const itemEl = listEl.createDiv({ cls: 'global-update-item' });

            const checkboxEl = itemEl.createEl('input', {
                type: 'checkbox',
                attr: { checked: 'checked' }
            });
            checkboxEl.checked = true;

            const labelEl = itemEl.createEl('label');
            labelEl.createSpan({ text: `"${entity.oldEntity}"`, cls: 'entity-old' });
            labelEl.createSpan({ text: ' → ' });
            labelEl.createSpan({ text: `"${entity.newEntity}"`, cls: 'entity-new' });
            labelEl.createSpan({
                text: ` (${entity.occurrences} ${t('occurrences')})`,
                cls: 'entity-count'
            });

            checkboxEl.addEventListener('change', () => {
                if (checkboxEl.checked) {
                    this.selectedEntities.add(entity.oldEntity);
                } else {
                    this.selectedEntities.delete(entity.oldEntity);
                }
            });
        }

        const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });

        const cancelBtn = buttonContainer.createEl('button', { text: t('Skip') });
        cancelBtn.addEventListener('click', () => {
            this.onCancel();
            this.close();
        });

        const confirmBtn = buttonContainer.createEl('button', {
            text: t('Update all'),
            cls: 'mod-cta'
        });
        confirmBtn.addEventListener('click', () => {
            const selected = this.entities.filter(e =>
                this.selectedEntities.has(e.oldEntity)
            );
            void this.onConfirm(selected);
            this.close();
        });
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

/**
 * 全局更新处理器
 * 检测实体变更 -> 提示用户 -> 应用全局更新
 */
export async function handleGlobalUpdate(
    app: App,
    apiManager: ApiManager,
    fullText: string,
    originalSelection: string,
    newSelection: string,
    selectionRange: { start: number; end: number },
    onApply: (newFullText: string) => void
): Promise<void> {
    console.debug('Global Update: Starting detection...', {
        originalSelection: originalSelection.substring(0, 100),
        newSelection: newSelection.substring(0, 100)
    });

    // 1. 检测实体变更
    const entities = await detectEntityChanges(apiManager, originalSelection, newSelection);

    console.debug('Global Update: Detected entities:', entities);

    if (entities.length === 0) {
        console.debug('Global Update: No entity changes detected');
        return; // 无实体变更
    }

    // 2. 统计文档中其他位置的出现次数
    // 计算新选区的结束位置（考虑长度变化）
    const newEnd = selectionRange.start + newSelection.length;
    const updatedFullText =
        fullText.substring(0, selectionRange.start) +
        newSelection +
        fullText.substring(selectionRange.end);

    const entitiesWithCounts: EntityChange[] = [];
    for (const entity of entities) {
        const { count, positions } = countEntityOccurrences(
            updatedFullText,
            entity.oldEntity,
            { start: selectionRange.start, end: newEnd }
        );

        console.debug(`Global Update: Entity "${entity.oldEntity}" found ${count} times in other locations`);

        if (count > 0) {
            entitiesWithCounts.push({
                ...entity,
                occurrences: count,
                positions
            });
        }
    }

    if (entitiesWithCounts.length === 0) {
        console.debug('Global Update: No other occurrences found in document');
        return; // 无其他引用需要更新
    }

    console.debug('Global Update: Showing modal for', entitiesWithCounts);

    // 3. 显示确认对话框
    new GlobalUpdateModal(
        app,
        entitiesWithCounts,
        async (selectedEntities) => {
            if (selectedEntities.length === 0) return;

            new Notice(t('Updating global references...'));

            // 4. 生成并应用全局补丁
            let currentText = updatedFullText;
            for (const entity of selectedEntities) {
                const patches = await generateGlobalPatches(
                    apiManager,
                    currentText,
                    entity.oldEntity,
                    entity.newEntity
                );

                if (patches.length > 0) {
                    const result = applyPatches(currentText, patches);
                    if (result.appliedCount > 0) {
                        currentText = result.text;
                    }
                }
            }

            onApply(currentText);
            new Notice(t('Global update completed'));
        },
        () => {
            // 用户跳过
        }
    ).open();
}
