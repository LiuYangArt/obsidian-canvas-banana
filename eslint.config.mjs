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
            // ========== Obsidian 官方审核规则（与 Review Bot 一致）==========
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
            // UI Sentence Case - 与 Review Bot 一致：enforceCamelCaseLower: true
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
    },
    // ========== 英文 locale 文件 Sentence Case 检查（与 Review Bot 完全一致）==========
    // Review Bot 使用 warn 级别，无自定义 options
    {
        files: [
            "**/en.ts",
            "**/en.js",
            "**/en.cjs",
            "**/en.mjs",
            "**/en-*.ts",
            "**/en-*.js",
            "**/en_*.ts",
            "**/en_*.js",
            "**/en/*.ts",
            "**/en/*.js",
            "**/en/**/*.ts",
            "**/en/**/*.js",
        ],
        plugins: {
            "obsidianmd": obsidianmd,
        },
        rules: {
            // 与 Review Bot 完全一致：无自定义 options（无 brands, 无 ignoreRegex）
            "obsidianmd/ui/sentence-case-locale-module": "error",
        }
    }
];
