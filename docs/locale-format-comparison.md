# 语言包格式对比：TypeScript vs JSON

> 日期：2025-12-17
> 参考项目：[obsidian-ai-providers](https://github.com/obsidian-ai-providers)

## 背景

Obsidian Review Bot 对我们的 `lang/locale/en.ts` 文件中的 API provider 相关文本报错：
- 禁止使用 `eslint-disable` 注释禁用 `sentence-case-locale-module` 规则
- 品牌名（Gemini、OpenRouter）、占位符（sk-...）、URL 等需要特殊处理

## 发现

`obsidian-ai-providers` 插件使用 **JSON 格式** 的语言包，从而完全绕过了 ESLint 的 sentence-case 检查。

### 文件结构对比

| 我们的项目 (TypeScript) | obsidian-ai-providers (JSON) |
|------------------------|------------------------------|
| `lang/locale/en.ts` | `src/i18n/en.json` |
| `lang/locale/zh-cn.ts` | `src/i18n/zh.json` |
| `lang/helpers.ts` | `src/i18n/index.ts` |

### 为什么 JSON 能绕过检查？

`obsidianmd/ui/sentence-case-locale-module` 规则只对 `.ts` / `.js` 文件生效，**不检查 JSON 文件**。

### 内容对比

两种格式的内容本质相同，只是语法不同：

**TypeScript 格式：**
```typescript
// lang/locale/en.ts
export default {
    'API key': 'API key',
    'Placeholder API key': 'sk-...',
    'Placeholder URL': 'https://api.example.com',
    'Google Gemini': 'Gemini (Google)',
};
```

**JSON 格式：**
```json
// src/i18n/en.json
{
    "settings": {
        "apiKey": "API key",
        "apiKeyPlaceholder": "sk-...",
        "providerUrlPlaceholder": "https://...",
    }
}
```

### obsidian-ai-providers 的 ESLint 配置

他们的 `.eslintrc` **没有启用** `eslint-plugin-obsidianmd`，只用了标准的 TypeScript ESLint 规则。

---

## 当前方案：TypeScript + 配置白名单

我们目前采用 **方案 A**：保持 TypeScript 格式，通过 ESLint 配置来白名单处理特殊文本。

在 `eslint.config.mjs` 中配置：
```javascript
"obsidianmd/ui/sentence-case-locale-module": ["error", {
    brands: ["Gemini", "Google", "OpenRouter", "Yunwu", "GPTGod", "AI", "API", "URL", "JSON"],
    ignoreWords: ["sk", "or", "v1", "AIza"],
    ignoreRegex: ["^sk-", "^AIza", "^https?://"]
}]
```

**优点**：
- 无需大规模重构
- 保持类型安全
- 移除了所有 `eslint-disable` 注释

**风险**：
- Review Bot 可能仍然报错（它可能不认 ESLint 配置的白名单选项）

---

## 备选方案：迁移到 JSON 格式

如果 Review Bot 仍然报错，可以参考 `obsidian-ai-providers` 迁移到 JSON 格式。

### 迁移步骤

1. 将 `lang/locale/en.ts` 和 `zh-cn.ts` 转换为 JSON 格式
2. 修改 `lang/helpers.ts` 来加载 JSON 文件
3. 更新 ESLint 配置，移除对语言文件的 sentence-case 规则

### 迁移后的结构

```
lang/
├── locale/
│   ├── en.json
│   └── zh-cn.json
└── helpers.ts    ← 修改为加载 JSON
```

### helpers.ts 示例（参考 obsidian-ai-providers）

```typescript
import en from './locale/en.json';
import zhCN from './locale/zh-cn.json';

const locales: Record<string, Record<string, string>> = { en, 'zh-cn': zhCN };

export function t(key: string, params?: Record<string, string>): string {
    const locale = window.localStorage.getItem('language') || 'en';
    const translations = locales[locale] || locales['en'];
    let result = translations[key] || en[key] || key;
    
    if (params) {
        Object.entries(params).forEach(([k, v]) => {
            result = result.replace(`{${k}}`, v);
        });
    }
    return result;
}
```

---

## 待办

- [ ] 等待 Review Bot 重新扫描（6小时内）
- [ ] 如果仍报错，执行迁移到 JSON 方案
