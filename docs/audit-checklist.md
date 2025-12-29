# Obsidian Plugin Audit Checklist (Updated 2025-12)

基于 Obsidian Review Bot 的反馈更新，严格遵循以提交 PR 审核。

> [!IMPORTANT]
> 提交前必须运行 `npm run lint`，确保安装了 `@obsidianmd/eslint-plugin`。

---

## 类型安全

### 1. NO 'any' types
Always define interfaces or use `unknown` with type guards.

```typescript
// ❌ Bad
catch (error: any) { console.log(error.message); }

// ✅ Good
catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
}
```

### 2. Type Guards for HTTP Errors
Use custom type guards for API error handling.

```typescript
interface HttpError { status: number; message: string; json?: Record<string, unknown>; }
function isHttpError(e: unknown): e is HttpError {
    return typeof e === 'object' && e !== null && 'status' in e;
}
```

### 3. No Object in Template Literals
模板字符串中不能使用可能为对象的表达式，否则会输出 `[object Object]`。

```typescript
// ❌ Bad: content 可能是 string | ContentPart[]
throw new Error(`API error: ${message.content || 'No response'}`);

// ✅ Good: 显式提取文本内容
const textContent = typeof message.content === 'string'
    ? message.content
    : JSON.stringify(message.content);
throw new Error(`API error: ${textContent || 'No response'}`);
```

### 4. No Unnecessary Type Assertions
不要使用不改变类型的 `as` 断言，ESLint 会报错。

```typescript
// ❌ Bad: value 已经是 string 类型
const text = value as string;

// ✅ Good: 直接使用
const text = value;
```

---

## Console 和调试

### 5. No console.log/group/groupEnd
Only allowed: `console.debug`, `console.warn`, `console.error`.

### 6. Remove debug logs before release
Use debug mode flags to conditionally log.

---

## DOM 操作

### 7. No Direct Style Manipulation
Do NOT use `el.style.width = 'x'`. Use CSS classes or `setCssProps`.

```typescript
// ❌ element.style.display = 'none';
// ❌ element.style.width = '100%';
// ❌ element.style.marginBottom = '10px';

// ✅ element.addClass('is-hidden');
// ✅ element.setCssProps({ '--my-width': '100%' });
```

### 8. No innerHTML/outerHTML
Use `createEl`, `createDiv`, `empty()` to prevent XSS.

---

## UI 规范

### 9. Sentence Case for UI Text
Use lowercase except first word (e.g., "Image generation model", not "Image Generation Model").

### 10. Settings UI
Use `new Setting().setHeading()`. Avoid top-level headings.

### 11. No Default Hotkeys
Do not set hotkeys in `addCommand`.

---

## Promise 和异步

### 12. Await or void Promises
Either await or explicitly ignore with `void`.

```typescript
// ❌ this.fetchModels();        // Unawaited - ESLint error!
// ✅ void this.fetchModels();   // Fire-and-forget
// ✅ await this.fetchModels();  // Wait for completion
```

### 13. Async methods must have await
If a method is `async`, it must contain `await`. Otherwise remove `async` keyword.

### 14. Promise Rejections
Must reject with `Error` object (not strings).

### 15. Override Method Signatures
重写父类/接口方法时，返回类型必须兼容。`PluginSettingTab.display()` 期望返回 `void`，不能返回 `Promise<void>`。

```typescript
// ❌ Bad: display() 期望 void，但返回 Promise
async display(): Promise<void> {
    await this.loadData();
}

// ✅ Good: 使用包装函数
display(): void {
    void this.renderSettings();
}
private async renderSettings(): Promise<void> {
    await this.loadData();
}
```

---

## 网络和安全

### 16. Network Requests
Use `requestUrl` instead of `fetch`.

### 17. Path Handling
Use `this.app.vault.configDir`, not hardcoded `.obsidian`.

### 18. No Global App
Use `this.app`, never `window.app`.

---

## 代码质量

### 19. Memory Management
Clear all intervals/timers/listeners in `onunload`.

### 20. Remove Unused Variables
Clean up unused imports and variables. Use `_` prefix for intentionally unused params.

### 21. Code Standards
No `var`, prefer `const`/`let`.

---

## 本地检查流程

### 22. Install Obsidian ESLint Plugin
提交前必须安装并运行 `eslint-plugin-obsidianmd`，这是 Obsidian 官方审核使用的规则集。

```bash
npm install --save-dev eslint-plugin-obsidianmd
```

在 `eslint.config.mjs` 中配置（注意：不能直接 spread `recommended` 配置，需要手动配置规则）:
```javascript
import obsidianmd from 'eslint-plugin-obsidianmd';
export default [
    {
        plugins: { "obsidianmd": obsidianmd },
        rules: {
            "obsidianmd/ui/sentence-case": ["error", { enforceCamelCaseLower: true }],
            // ... 其他 obsidianmd 规则
        }
    }
];
```

---

## Pre-submission Checklist

- [ ] `npm run build` 构建成功
- [ ] `npm run lint` 无错误（ESLint 包含 @obsidianmd/eslint-plugin）
- [ ] 所有 UI 文本使用 Sentence case（仅首字母大写）
- [ ] 无 `element.style.xxx` 直接样式操作
- [ ] 无未处理的 Promise（使用 `void` 或 `await`）
- [ ] 无未使用的变量（以 `_` 开头的除外）
- [ ] 模板字符串中无可能为对象的表达式
- [ ] 无不必要的类型断言
- [ ] `PluginSettingTab.display()` 返回 `void` 而非 `Promise`
