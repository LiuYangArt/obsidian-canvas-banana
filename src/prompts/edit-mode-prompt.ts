// 固定部分 - 不可配置，确保 AI 输出 JSON 格式
export const EDIT_MODE_OUTPUT_FORMAT = `Output a JSON object with a single key "replacement" containing the rewritten text.
Example: { "replacement": "New text content" }`;

// 用户可配置部分 - 角色和风格
export const DEFAULT_EDIT_MODE_PROMPT = `You are an expert text editor. Rewrite the target text based on the user's instruction.
Maintain the original tone and style unless instructed otherwise.`;

/**
 * 构建完整的 Edit Mode System Prompt
 * 固定格式指令 + 用户配置的角色/风格
 */
export function buildEditModeSystemPrompt(userPrompt: string): string {
    const trimmed = userPrompt?.trim() || DEFAULT_EDIT_MODE_PROMPT;
    return `${trimmed}\n\n${EDIT_MODE_OUTPUT_FORMAT}`;
}
