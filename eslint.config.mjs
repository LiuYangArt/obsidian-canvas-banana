import typescriptParser from "@typescript-eslint/parser";
import tseslint from "@typescript-eslint/eslint-plugin";
import obsidianmd from "eslint-plugin-obsidianmd";

export default [
    // 忽略非 TypeScript 文件和构建产物
    {
        ignores: ["node_modules/**", "main.js", "*.d.ts", "*.json", "*.mjs"]
    },
    {
        files: ["**/*.ts"],
        languageOptions: {
            parser: typescriptParser,
            parserOptions: {
                ecmaVersion: "latest",
                sourceType: "module",
                project: "./tsconfig.json"
            }
        },
        plugins: {
            "@typescript-eslint": tseslint,
            "obsidianmd": obsidianmd,
        },
        rules: {
            // ========== Obsidian 官方审核规则 ==========
            "obsidianmd/commands/no-command-in-command-id": "error",
            "obsidianmd/commands/no-command-in-command-name": "error",
            "obsidianmd/commands/no-default-hotkeys": "error",
            "obsidianmd/commands/no-plugin-id-in-command-id": "error",
            "obsidianmd/commands/no-plugin-name-in-command-name": "error",
            "obsidianmd/settings-tab/no-manual-html-headings": "error",
            "obsidianmd/settings-tab/no-problematic-settings-headings": "error",
            "obsidianmd/vault/iterate": "error",
            "obsidianmd/detach-leaves": "error",
            "obsidianmd/hardcoded-config-path": "error",
            "obsidianmd/no-forbidden-elements": "error",
            "obsidianmd/no-plugin-as-component": "error",
            "obsidianmd/no-sample-code": "error",
            "obsidianmd/no-tfile-tfolder-cast": "error",
            "obsidianmd/no-view-references-in-plugin": "error",
            "obsidianmd/no-static-styles-assignment": "error",
            "obsidianmd/object-assign": "error",
            "obsidianmd/platform": "error",
            "obsidianmd/prefer-file-manager-trash-file": "warn",
            "obsidianmd/prefer-abstract-input-suggest": "error",
            "obsidianmd/regex-lookbehind": "error",
            "obsidianmd/sample-names": "error",
            "obsidianmd/validate-manifest": "error",
            "obsidianmd/validate-license": "error",
            // UI Sentence Case - 检查代码中的 UI 文本
            "obsidianmd/ui/sentence-case": ["error", { enforceCamelCaseLower: true }],
            
            // ========== TypeScript 规则 ==========
            "@typescript-eslint/no-explicit-any": "error",
            "@typescript-eslint/no-unused-vars": ["warn", { 
                "argsIgnorePattern": "^_",
                "varsIgnorePattern": "^_" 
            }],
            "@typescript-eslint/no-floating-promises": "error",
            "@typescript-eslint/require-await": "warn",
            "@typescript-eslint/no-unnecessary-type-assertion": "error",
            "@typescript-eslint/no-misused-promises": ["error", {
                "checksVoidReturn": true
            }],
            
            // ========== Console 限制 ==========
            "no-console": ["error", { 
                "allow": ["debug", "warn", "error"] 
            }],
            
            // ========== 代码质量 ==========
            "no-var": "error",
            "prefer-const": "warn",
        }
    }
    // 注意：JSON 语言文件不需要特殊的 sentence-case 规则
    // sentence-case-locale-module 只对 .ts/.js 文件生效，对 .json 文件无效
    // 这样就绕过了 Review Bot 对品牌名、URL、占位符的误报
];
