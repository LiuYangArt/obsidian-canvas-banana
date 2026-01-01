/**
 * Preset Manager - 通用预设管理工具
 * 供 FloatingPalette、SideBarCoPilotView、NotesEditPalette 共用
 */

import { App, Notice } from 'obsidian';
import { PromptPreset } from '../settings/settings';
import { InputModal, ConfirmModal } from './modals';
import { t } from '../../lang/helpers';
import { generateId } from '../utils/image-utils';

export interface PresetManagerConfig {
    getPresets: () => PromptPreset[];
    setPresets: (presets: PromptPreset[]) => void;
    getInputValue: () => string;
    getSelectValue: () => string;
    refreshDropdown: () => void;
    setSelectValue?: (id: string) => void;
}

/**
 * 通用预设管理工具类
 */
export class PresetManager {
    constructor(
        private app: App,
        private config: PresetManagerConfig
    ) {}

    handleAdd(): void {
        new InputModal(
            this.app,
            t('New Preset'),
            t('Enter preset name'),
            '',
            (name) => {
                const newPreset: PromptPreset = {
                    id: generateId(),
                    name: name,
                    prompt: this.config.getInputValue()
                };
                const presets = [...this.config.getPresets(), newPreset];
                this.config.setPresets(presets);
                this.config.refreshDropdown();
                this.config.setSelectValue?.(newPreset.id);
            }
        ).open();
    }

    handleDelete(): void {
        const selectedId = this.config.getSelectValue();
        if (!selectedId) {
            new Notice(t('Please select preset delete'));
            return;
        }
        const presets = this.config.getPresets();
        const preset = presets.find(p => p.id === selectedId);
        if (!preset) return;

        new ConfirmModal(
            this.app,
            t('Delete Preset Confirm', { name: preset.name }),
            () => {
                const newPresets = presets.filter(p => p.id !== selectedId);
                this.config.setPresets(newPresets);
                this.config.refreshDropdown();
            }
        ).open();
    }

    handleSave(): void {
        const selectedId = this.config.getSelectValue();
        if (!selectedId) {
            new Notice(t('Please select preset save'));
            return;
        }
        const presets = this.config.getPresets();
        const preset = presets.find(p => p.id === selectedId);
        if (!preset) return;

        preset.prompt = this.config.getInputValue();
        this.config.setPresets([...presets]);
        new Notice(t('Preset saved', { name: preset.name }));
    }

    handleRename(): void {
        const selectedId = this.config.getSelectValue();
        if (!selectedId) {
            new Notice(t('Please select preset rename'));
            return;
        }
        const presets = this.config.getPresets();
        const preset = presets.find(p => p.id === selectedId);
        if (!preset) return;

        new InputModal(
            this.app,
            t('Rename Preset'),
            t('Enter new name'),
            preset.name,
            (newName) => {
                preset.name = newName;
                this.config.setPresets([...presets]);
                this.config.refreshDropdown();
                this.config.setSelectValue?.(selectedId);
            }
        ).open();
    }
}
