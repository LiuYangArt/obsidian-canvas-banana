import typescriptEslint from "@typescript-eslint/eslint-plugin";
import typescriptParser from "@typescript-eslint/parser";

export default [
    {
        files: ["**/*.ts"],
        ignores: ["node_modules/**", "main.js", "*.d.ts"],
        languageOptions: {
            parser: typescriptParser,
            parserOptions: {
                ecmaVersion: "latest",
                sourceType: "module"
            }
        },
        plugins: {
            "@typescript-eslint": typescriptEslint
        },
        rules: {
            // ========== Obsidian Plugin Audit Rules ==========
            
            // Type Safety - NO 'any' types
            "@typescript-eslint/no-explicit-any": "error",
            
            // Unused variables (allow underscore prefix)
            "@typescript-eslint/no-unused-vars": ["warn", { 
                "argsIgnorePattern": "^_",
                "varsIgnorePattern": "^_" 
            }],
            
            // Console restrictions - only debug/warn/error allowed
            "no-console": ["error", { 
                "allow": ["debug", "warn", "error"] 
            }],
            
            // Code quality
            "no-var": "error",
            "prefer-const": "warn",
            
            // Async/Await best practices
            "require-await": "warn",
            
            // No innerHTML for XSS prevention (custom check via comments)
            // Note: This needs manual review as ESLint doesn't have a built-in rule
        }
    }
];
