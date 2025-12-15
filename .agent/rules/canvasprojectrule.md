---
trigger: always_on
---

这是一个obsidian 插件项目
在 Obsidian Canvas 视图中集成 Gemini AI，允许用户选中画布中的节点（文本、图片、群组）作为上下文，进行 AI 对话、文本生成或图像生成，并将结果无缝回写到画布中。
canvas 是 .json 格式。 



language: simplified chinese
- 总是使用中文回答我
- 总是使用中文进行代码注释

---
coding rules

- 总是使用 context 7 mcp 检索api
- 每次改动完成后必须执行 npm run build 来构建代码

---
多语言支持规范 (Localization)

本项目已集成多语言支持（目前支持 English `en` 和 Simplified Chinese `zh-cn`）。新增功能或 UI 文本时，必须遵循以下规范：

1.  **文件结构**：
    *   `lang/locale/en.ts`: 英文语言包（Source of Truth）。所有的 Key 必须在此定义。
    *   `lang/locale/zh-cn.ts`: 中文语言包。
    *   `lang/helpers.ts`: 提供 `t()` 辅助函数。

2.  **添加新文本**：
    *   首先在 `lang/locale/en.ts` 中添加 Key-Value。Key 推荐使用英文原文（便于阅读）或 PascalCase ID。
    *   在 `lang/locale/zh-cn.ts` 中添加对应的中文翻译。

3.  **代码调用**：
    *   引入 helper: `import { t } from './lang/helpers';` (请根据当前文件位置调整相对路径)。
    *   使用 `t('Key Name')` 替换所有 UI 硬编码字符串。
    *   支持参数插值：如果在语言包中定义了 `Hello {name}`，调用时使用 `t('Hello {name}', { name: 'World' })`。

---

docs 下的 design_doc.md 是本项目的设计文档。制作的时候随时参考。 


参考：

obsidian插件文档和示例工程

https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin

https://github.com/obsidianmd/obsidian-sample-plugin



obsidian canvas api

canvas 是json格式

https://jsoncanvas.org/

https://github.com/obsidianmd/jsoncanvas

https://forum.obsidian.md/t/any-details-on-the-canvas-api/57120/4



google gemini api文档

https://ai.google.dev/gemini-api/docs

https://ai.google.dev/gemini-api/docs/image-generationgem



open router api文档

https://openrouter.ai/google/gemini-3-pro-preview/api

https://openrouter.ai/google/gemini-3-pro-image-preview/api

https://openrouter.ai/docs/quickstart

---

### Obsidian Plugin Audit Checklist (Updated 2025-12)

Strict requirements for plugin review submission:

#### 类型安全
1.  **NO 'any' types**: Always define interfaces or use `unknown` with type guards.
    ```typescript
    // ❌ Bad
    catch (error: any) { console.log(error.message); }
    
    // ✅ Good
    catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
    }
    ```

2.  **Type Guards for HTTP Errors**: Use custom type guards for API error handling.
    ```typescript
    interface HttpError { status: number; message: string; json?: Record<string, unknown>; }
    function isHttpError(e: unknown): e is HttpError {
        return typeof e === 'object' && e !== null && 'status' in e;
    }
    ```

#### Console 和调试
3.  **No console.log/group/groupEnd**: Only allowed: `console.debug`, `console.warn`, `console.error`.
4.  **Remove debug logs before release**: Use debug mode flags to conditionally log.

#### DOM 操作
5.  **No Direct Style Manipulation**: Do NOT use `el.style.width = 'x'`. Use CSS classes.
    ```typescript
    // ❌ element.style.display = 'none';
    // ✅ element.addClass('is-hidden');
    ```

6.  **No innerHTML/outerHTML**: Use `createEl`, `createDiv`, `empty()` to prevent XSS.

#### UI 规范
7.  **Sentence Case for UI Text**: Use lowercase except first word (e.g., "Image generation model").
8.  **Settings UI**: Use `new Setting().setHeading()`. Avoid top-level headings.
9.  **No Default Hotkeys**: Do not set hotkeys in `addCommand`.

#### Promise 和异步
10. **Await or void Promises**: Either await or explicitly ignore with `void`.
    ```typescript
    // ❌ this.fetchModels();        // Unawaited
    // ✅ void this.fetchModels();   // Fire-and-forget
    // ✅ await this.fetchModels();  // Wait for completion
    ```

11. **Async methods must have await**: If a method is `async`, it must contain `await`.
12. **Promise Rejections**: Must reject with [Error](cci:2://file:///e:/SF_ActiveDocs/MyPlugins/ObsidianCanvasAI/api-manager.ts:13:0-17:1) object (not strings).

#### 网络和安全
13. **Network Requests**: Use [requestUrl](cci:1://file:///e:/SF_ActiveDocs/MyPlugins/ObsidianCanvasAI/api-manager.ts:31:0-45:1) instead of [fetch](cci:1://file:///e:/SF_ActiveDocs/MyPlugins/ObsidianCanvasAI/main.ts:2973:4-3049:5).
14. **Path Handling**: Use `this.app.vault.configDir`, not hardcoded `.obsidian`.
15. **No Global App**: Use `this.app`, never `window.app`.

#### 代码质量
16. **Memory Management**: Clear all intervals/timers/listeners in [onunload](cci:1://file:///e:/SF_ActiveDocs/MyPlugins/ObsidianCanvasAI/main.ts:1256:4-1263:5).
17. **Remove Unused Variables**: Clean up unused imports and variables.
18. **Code Standards**: No `var`, prefer [const](cci:1://file:///e:/SF_ActiveDocs/MyPlugins/ObsidianCanvasAI/main.ts:178:4-184:5)/[let](cci:2://file:///e:/SF_ActiveDocs/MyPlugins/ObsidianCanvasAI/main.ts:165:0-165:45).