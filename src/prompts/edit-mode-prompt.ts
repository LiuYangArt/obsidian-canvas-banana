// 固定部分 - 不可配置，确保 AI 输出 JSON 格式
export const EDIT_MODE_OUTPUT_FORMAT = `Output a JSON object with these keys:
- "replacement": The rewritten text
- "summary": A brief description of what changes you made (in the same language as the user's instruction)

Example: { "replacement": "New text content", "summary": "Improved clarity and fixed grammar" }`;

// 全局一致性模式的输出格式
export const EDIT_MODE_GLOBAL_FORMAT = `You must output a JSON object with these keys:
- "replacement": The rewritten target text
- "globalChanges": Array of other text segments in the document that should be updated for consistency (e.g., if you renamed an entity, include all other occurrences). Each item has "original" (exact text to find) and "new" (replacement text). Leave empty [] if no global changes needed.
- "summary": A brief description of what changes you made (in the same language as the user's instruction)

Example:
{
  "replacement": "David is the main character...",
  "globalChanges": [
    { "original": "Adam said hello", "new": "David said hello" },
    { "original": "Adam's house", "new": "David's house" }
  ],
  "summary": "将主角名从 Adam 改为 David，并更新了 2 处引用"
}`;

// 用户可配置部分 - 角色和风格
export const DEFAULT_EDIT_MODE_PROMPT = `You are an expert text editor. Rewrite the target text based on the user's instruction.
Maintain the original tone and style unless instructed otherwise.`;

/**
 * 构建完整的 Edit Mode System Prompt
 * 固定格式指令 + 用户配置的角色/风格
 */
export function buildEditModeSystemPrompt(userPrompt: string, enableGlobalConsistency: boolean = false): string {
    const trimmed = userPrompt?.trim() || DEFAULT_EDIT_MODE_PROMPT;
    const format = enableGlobalConsistency ? EDIT_MODE_GLOBAL_FORMAT : EDIT_MODE_OUTPUT_FORMAT;
    return `${trimmed}\n\n${format}`;
}
