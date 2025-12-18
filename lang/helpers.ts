import { moment } from 'obsidian';
import en from './locale/en.json';
import zhCN from './locale/zh-cn.json';

// Define the type of our keys based on the English file (source of truth)
export type LocaleKeys = keyof typeof en;

const localeMap: Record<string, Partial<typeof en>> = {
    'en': en,
    'zh-cn': zhCN,
    'zh': zhCN,
};

// Get the current locale from Obsidian (via moment)
const currentLocale = moment.locale();

/**
 * Get a localized string
 */
export function t(key: LocaleKeys, params?: Record<string, string | number>): string {
    // Determine language
    let lang = currentLocale;

    // Simplistic mapping: if it starts with zh, use zh-cn
    if (lang.startsWith('zh')) {
        lang = 'zh-cn';
    }

    // Default to English if locale not found
    if (!localeMap[lang]) {
        lang = 'en';
    }

    const dict = localeMap[lang];
    let str = dict[key] || en[key] || key;

    if (params) {
        Object.keys(params).forEach(k => {
            str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(params[k]));
        });
    }

    return str;
}
