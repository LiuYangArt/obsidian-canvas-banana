# Note 模式图片生成设计

## 1. 目标 (Goal)

在 Obsidian Notes 编辑器中支持 AI 图片生成功能。用户可以：
1. **悬浮面板模式**：选中文本后，使用选中文本作为上下文，通过 prompt 生成图片并插入到选区末尾。
2. **侧边栏模式**：在侧边栏对话中生成图片，并插入到当前光标位置。

![用户参考设计图](../../assets/note-image-gen-ref.png)

---

## 2. UI 变更

### 2.1 Tab 结构调整

#### 悬浮面板 (NotesEditPalette)
**当前**: 无 Tab，仅 Edit Mode。

**目标**: 增加 2 个 Tab：
- `Edit` (现有功能，AI 编辑选中文本)
- `Image` (新增，AI 图片生成)

```
┌────────────────────────────────────┐
│  [ Edit ]  [ Image ]          [×]  │
├────────────────────────────────────┤
│  Select prompt preset       [+ - ] │
├────────────────────────────────────┤
│  ┌──────────────────────────────┐  │
│  │ Describe the image...       │  │
│  │                              │  │
│  └──────────────────────────────┘  │
├────────────────────────────────────┤
│  (Image Mode Only)                 │
│  Resolution [1K ▼]  Ratio [16:9 ▼] │
│  Model [gemini-pro-image ▼]        │
├────────────────────────────────────┤
│        [ GENERATE ]                │
└────────────────────────────────────┘
```

#### 侧边栏 (SideBarCoPilotView)
**当前**: 无 Tab，仅 Chat 功能。

**目标**: 增加 2 个 Tab：
- `Edit` (对话式文档编辑)
- `Image` (图片生成)

---

### 2.2 Image Mode 控件

| 控件 | 选项 | 默认值 |
|------|------|--------|
| Resolution | 1K / 2K / 4K | 1K |
| Ratio | 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9 | 16:9 |
| Model | Quick Switch Image Models | 首个配置的模型 |

---

## 3. 交互流程

### 3.1 悬浮面板 - 选中文本生成图片

```mermaid
sequenceDiagram
    participant User
    participant FloatingBtn
    participant Palette
    participant Handler
    participant API
    participant Editor

    User->>User: 选中一段文本
    User->>FloatingBtn: 点击悬浮按钮
    FloatingBtn->>Palette: 显示面板 (捕获选区)
    User->>Palette: 切换到 Image Tab
    User->>Palette: 输入 "根据这段文字生成图片"
    User->>Palette: 点击 GENERATE
    Palette->>Handler: handleGeneration(prompt, 'image')
    Handler->>API: generateImageWithRoles(..., selectedText)
    API-->>Handler: 返回 base64 图片
    Handler->>Editor: 在选区末尾插入 ![[image.png]]
    Editor-->>User: 图片显示在文档中
```

**关键点**：
1. 选中文本作为 **contextText** 传入 API。
2. 用户 prompt 作为 **instruction** 传入 API。
3. 图片保存到 vault（与 Canvas 模式一致）。
4. 插入位置：选区结束位置之后，新起一行。

---

### 3.2 侧边栏 - 对话式图片生成

```mermaid
sequenceDiagram
    participant User
    participant Sidebar
    participant Handler
    participant API
    participant Editor

    User->>Sidebar: 切换到 Image Tab
    User->>Sidebar: 输入 "生成一个卡通狗"
    User->>Sidebar: 点击 Send / Ctrl+Enter
    Sidebar->>Handler: handleGenerate('image')
    Handler->>API: generateImageWithRoles(prompt, ...)
    API-->>Handler: 返回 base64 图片
    Handler->>Sidebar: 显示图片预览
    Handler->>Editor: 在光标位置插入 ![[image.png]]
    Editor-->>User: 图片显示在文档中
```

**关键点**：
1. 当前文档内容 (可选) 可作为 contextText。
2. 图片插入到 **当前光标位置**。
3. 如果无活跃编辑器，提示错误。

---

## 4. 技术实现

### 4.1 文件修改清单

#### [MODIFY] [notes-edit-palette.ts](file:///f:/CodeProjects/ObsidianCanvasAI/src/notes/notes-edit-palette.ts)
- 添加 Tab 结构 (`edit` / `image`)
- 增加 `currentMode: 'edit' | 'image'` 状态
- Image Mode 时显示 Resolution / Ratio / Model 控件
- 修改 `handleGenerate()` 传递 mode 参数

#### [MODIFY] [sidebar-copilot-view.ts](file:///f:/CodeProjects/ObsidianCanvasAI/src/notes/sidebar-copilot-view.ts)
- 添加 Tab 结构 (`edit` / `image`)
- 增加 `currentMode: 'edit' | 'image'` 状态
- Image Mode 时显示 Resolution / Ratio / Model 控件
- 新增 `handleImageGeneration()` 方法

#### [MODIFY] [notes-selection-handler.ts](file:///f:/CodeProjects/ObsidianCanvasAI/src/notes/notes-selection-handler.ts)
- 修改 `handleGeneration(prompt, mode)` 支持 `'image'` 模式
- 增加 `handleImageGeneration()` 方法，调用 API 并插入图片
- 图片插入逻辑：`editor.replaceRange('\n![](${imagePath})\n', endPos)`

#### [MODIFY] [settings.ts](file:///f:/CodeProjects/ObsidianCanvasAI/src/settings/settings.ts)
- 增加 `noteImagePresets: PromptPreset[]` (Note 模式 Image Tab 专用预设)
- 增加 `noteImageResolution: string` 和 `noteImageAspectRatio: string`

#### [MODIFY] [styles.css](file:///f:/CodeProjects/ObsidianCanvasAI/styles.css)
- 复用现有 `.canvas-ai-tabs` `.canvas-ai-tab` 样式
- Note 面板特定样式调整 (如更窄的宽度)

---

### 4.2 核心代码逻辑

#### 4.2.1 图片生成流程 (handleImageGeneration)

```typescript
async handleImageGeneration(prompt: string): Promise<void> {
    const { editor, file } = this.lastContext;
    if (!editor || !file) {
        new Notice(t('No active editor'));
        return;
    }

    // 1. 获取选中文本作为 context (如果有)
    const selectedText = editor.getSelection() || '';
    
    // 2. 调用 API
    const options = this.palette.getImageOptions();
    const aspectRatio = this.normalizeAspectRatio(options.aspectRatio);
    const resolution = options.resolution;
    
    const result = await this.apiManager.generateImageWithRoles(
        prompt,                // instruction
        [],                    // inputImages (可扩展：支持 ![[image]] 作为输入)
        selectedText,          // contextText
        aspectRatio,
        resolution
    );
    
    // 3. 保存图片到 vault
    const imagePath = await this.saveImageToVault(result, file);
    
    // 4. 插入到选区末尾
    const endPos = editor.getCursor('to');
    const insertText = `\n![[${imagePath}]]\n`;
    editor.replaceRange(insertText, endPos);
}
```

#### 4.2.2 图片保存逻辑 (复用 Canvas 逻辑)

```typescript
async saveImageToVault(base64DataUrl: string, currentFile: TFile): Promise<string> {
    const timestamp = Date.now();
    const fileName = `ai-generated-${timestamp}.png`;
    
    // 保存到与当前文件相同目录
    const folder = currentFile.parent?.path || '';
    const filePath = folder ? `${folder}/${fileName}` : fileName;
    
    // 转换 base64 并写入
    const base64 = base64DataUrl.replace(/^data:image\/\w+;base64,/, '');
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    
    await this.app.vault.createBinary(filePath, bytes);
    return fileName;  // 返回相对路径供 ![[]] 使用
}
```

---

### 4.3 选中文本作为 Context

当用户在悬浮面板中使用 Image Mode 时：

| 场景 | Context | Prompt | 结果 |
|------|---------|--------|------|
| 选中 "一只猫在屋顶上" | "一只猫在屋顶上" | "生成图片" | API 收到 context + instruction |
| 选中文字，prompt 为空 | "一只猫在屋顶上" | (默认) "根据上下文生成图片" | 使用选中文字生成 |
| 无选中，直接输入 prompt | (空) | "画一只猫" | 仅使用 prompt |

---

## 5. Settings 说明

> [!NOTE]
> Note 模式的图片生成 **统一复用 Canvas 配置**，无需新增独立设置项。

复用的配置项：

| 配置项 | 说明 |
|--------|------|
| `imagePresets` | Image Mode 预设（共享） |
| `defaultResolution` | 默认分辨率 '1K' |
| `defaultAspectRatio` | 默认宽高比 '1:1' |
| `paletteImageModel` | Quick Switch 选中的 Image 模型 |
| `quickSwitchImageModels` | 可选的 Image 模型列表 |

---

## 6. 限制与边界

1. **仅支持 Markdown 文件**：非 .md 文件不支持图片插入。
2. **图片格式**：统一保存为 PNG。
3. **侧边栏无选区**：侧边栏生成图片时不捕获编辑器选区，仅使用 prompt。
4. **API 超时**：使用 `imageGenerationTimeout` 设置（默认 120s）。

---

## 7. 验证计划

### 7.1 手动验证

1. **悬浮面板 Image Tab**
   - 打开任意 .md 文件
   - 选中一段文字（如 "一只可爱的小狗"）
   - 点击悬浮按钮，切换到 Image Tab
   - 输入 "将这段描述转换为图片"，点击 GENERATE
   - 验证：图片插入到选区末尾

2. **侧边栏 Image Tab**
   - 打开侧边栏，切换到 Image Tab
   - 将光标放在文档中某位置
   - 输入 "生成一只卡通猫"，点击发送
   - 验证：图片插入到光标位置

3. **无选区/无光标测试**
   - 在没有打开任何文件时尝试生成
   - 验证：显示错误提示

4. **构建验证**
   ```bash
   npm run build
   npm run lint
   ```

---

## 8. 未来扩展

### 8.1 [ ] 图片输入参考 (Image-to-Image Context)

**目标**：支持选中文档内嵌图片 `![[image.png]]` 作为图片生成的输入参考，实现类似 Canvas 图生图的功能。

#### 交互流程

```mermaid
sequenceDiagram
    participant User
    participant Palette
    participant Handler
    participant API

    User->>User: 选中 "![[ref.png]]" 或含图片的文本
    User->>Palette: 打开 Image Tab
    User->>Palette: 输入 "基于这张图生成卡通版本"
    Palette->>Handler: handleImageGeneration(prompt)
    Handler->>Handler: 解析选区中的 ![[image]]
    Handler->>Handler: 读取图片 + WebP 压缩
    Handler->>API: generateImageWithRoles(prompt, inputImages, ...)
    API-->>Handler: 返回新图片
    Handler->>User: 插入生成的图片
```

#### 技术实现

```typescript
// notes-selection-handler.ts - handleImageGeneration 增强
private async handleImageGeneration(prompt: string): Promise<void> {
    // 1. 解析选中文本中的内嵌图片
    const embeddedImages = this.extractEmbeddedImages(selectedText);
    
    // 2. 读取并压缩图片（复用 Canvas 机制）
    const inputImages: ImageContext[] = [];
    for (const imgPath of embeddedImages) {
        const resolved = this.resolveImagePath(file.path, imgPath);
        if (resolved) {
            const imgData = await CanvasConverter.readSingleImageFile(
                this.app,
                resolved,
                settings.imageCompressionQuality,  // WebP 压缩质量
                settings.imageMaxSize               // 最大尺寸限制
            );
            if (imgData) {
                inputImages.push({
                    base64: imgData.base64,
                    mimeType: imgData.mimeType,
                    type: 'image'
                });
            }
        }
    }
    
    // 3. 调用 API（inputImages 作为参考图）
    const result = await localApiManager.generateImageWithRoles(
        instruction,
        inputImages,      // 参考图片
        contextText,       // 文本上下文
        aspectRatio,
        resolution
    );
}

// 提取内嵌图片语法
private extractEmbeddedImages(text: string): string[] {
    const regex = /!\[\[([^\]]+\.(png|jpg|jpeg|gif|webp|bmp))\]\]/gi;
    const matches: string[] = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
        matches.push(match[1]);
    }
    return matches;
}
```

#### 复用模块

| 模块 | 来源 | 功能 |
|------|------|------|
| `CanvasConverter.readSingleImageFile` | `canvas-converter.ts` | 读取图片 + WebP 压缩 |
| `resolveImagePath` | 已在 handler 中实现 | 解析相对/绝对路径 |
| `generateImageWithRoles` | `api-manager.ts` | 支持 inputImages 参数 |

#### 验证计划

1. 选中 `![[photo.png]]` → 输入 "转成水彩风格" → 验证生成的图片基于参考图
2. 选中 "一只猫 ![[cat.jpg]]" → 输入 "生成类似的狗" → 验证同时使用文本和图片上下文
3. 选中多张图片 → 验证最多处理 MAX_IMAGES (14) 张

---

### 8.2 [ ] 图片编辑 (Image-to-Image)

基于 8.1 实现，增加对已有图片的编辑能力。

### 8.3 [ ] 批量生成多张图片

支持一次生成多张候选图片，用户选择后插入。
