/**
 * Utils - 共享工具函数
 */

/**
 * 格式化 API Provider 名称为友好显示
 */
export function formatProviderName(provider: string): string {
    switch (provider.toLowerCase()) {
        case 'openrouter': return 'OpenRouter';
        case 'yunwu': return 'Yunwu';
        case 'gemini': return 'Gemini';
        case 'gptgod': return 'GPTGod';
        default: return provider.charAt(0).toUpperCase() + provider.slice(1);
    }
}
