import typescriptParser from "@typescript-eslint/parser";
import tseslint from "@typescript-eslint/eslint-plugin";
import obsidianmd from "eslint-plugin-obsidianmd";

export default [
    // 忽略非 TypeScript 文件
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
            ...obsidianmd.configs.recommended,
            
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
];
