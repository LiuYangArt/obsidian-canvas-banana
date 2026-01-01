// 固定部分 - 不可配置，确保 AI 输出 JSON 格式
export const EDIT_MODE_OUTPUT_FORMAT = `Output a JSON object with these keys:
- "replacement": The rewritten text
- "summary": A brief description of what changes you made (in the same language as the user's instruction)

Example: { "replacement": "New text content", "summary": "Improved clarity and fixed grammar" }`;

// 全局一致性模式的输出格式
export const EDIT_MODE_GLOBAL_FORMAT = `You must output a JSON object with these keys:
- "replacement": The rewritten target text
- "globalChanges": Array of other text segments in the document that should be updated for consistency. Each item has "original" (exact text to find in doc) and "new" (replacement text). Leave empty [] if no global changes needed.

IMPORTANT - Entity Reference Detection:
When renaming an entity (person, place, object, etc.), you MUST find ALL references including:
1. Full name occurrences (e.g., "草薙素子" → "Lucy")
2. Partial name / nickname / abbreviation (e.g., "素子" → "Lucy", "Adam" → "David" when full name was "Adam Smith")
3. Context-dependent shorthand forms commonly used in the document

Scan the ENTIRE document context carefully for any form of reference to the renamed entity.

- "summary": A brief description of what changes you made (in the same language as the user's instruction)

Example (renaming "草薙素子" to "Lucy"):
{
  "replacement": "Lucy is the main character...",
  "globalChanges": [
    { "original": "草薙素子说", "new": "Lucy说" },
    { "original": "素子的房间", "new": "Lucy的房间" },
    { "original": "素子笑了", "new": "Lucy笑了" }
  ],
  "summary": "将主角名从草薙素子改为 Lucy，并更新了全文 3 处引用（包括简称'素子'）"
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
