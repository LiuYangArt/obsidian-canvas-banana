/**
 * Notes AI Module
 * 为 Obsidian Markdown notes 提供 AI 编辑支持
 */

export { NotesSelectionHandler } from './notes-selection-handler';
export { NotesFloatingButton } from './notes-floating-button';
export { NotesEditPalette } from './notes-edit-palette';
export { applyPatches, parseAIPatches } from './text-patcher';
export type { TextChange, PatchResult } from './text-patcher';
export { handleGlobalUpdate, detectEntityChanges, GlobalUpdateModal } from './global-update';
export type { EntityChange, GlobalUpdateResult } from './global-update';
