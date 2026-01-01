# Antigravity Manager 图像生成接口文档

> 本文档记录了 Canvas Banana 插件中 AntigravityTools Provider 的图像生成实现细节。

## 1. 实现概览

AntigravityTools Provider 统一使用 `/v1/chat/completions` 端点进行图像生成：

| 场景 | 端点 | 说明 |
| :--- | :--- | :--- |
| **文生图** | `/v1/chat/completions` | 纯文本到图像，通过模型后缀控制比例 |
| **图生图** | `/v1/chat/completions` | 传递参考图片，通过模型后缀控制分辨率/比例 |

底层调用的是 **Google Internal API** (`cloudcode-pa.googleapis.com/v1internal`)。

---

## 2. 请求格式

### 端点
```
POST {baseUrl}/v1/chat/completions
```

### 请求体
```json
{
  "model": "gemini-3-pro-image-4k-16x9",
  "messages": [{
    "role": "user",
    "content": [
      { "type": "text", "text": "System prompt..." },
      { "type": "text", "text": "\n[Ref: reference image]" },
      { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } },
      { "type": "text", "text": "\nINSTRUCTION: Transform this image..." }
    ]
  }]
}
```

> 文生图时，`content` 数组中不包含 `image_url` 类型的元素。

---

## 3. 模型后缀控制

通过模型名后缀控制分辨率和比例：

| 后缀 | 说明 | 示例 |
| :--- | :--- | :--- |
| `-4k` 或 `-hd` | 4K 分辨率 | `gemini-3-pro-image-4k` |
| `-21x9` | 21:9 比例 | `gemini-3-pro-image-21x9` |
| `-16x9` | 16:9 比例 | `gemini-3-pro-image-16x9` |
| `-9x16` | 9:16 比例 | `gemini-3-pro-image-9x16` |
| `-4x3` | 4:3 比例 | `gemini-3-pro-image-4x3` |
| `-3x4` | 3:4 比例 | `gemini-3-pro-image-3x4` |

可组合使用：`gemini-3-pro-image-4k-16x9`

> [!WARNING]
> `-2k` 后缀目前不被 Antigravity-Manager 支持（已提交 Issue）。

---

## 4. AspectRatio 到 Size 映射 (备用)

用于 `aspectRatioToSize` 辅助方法：

| aspectRatio | size |
| :--- | :--- |
| `1:1` | `1024x1024` |
| `21:9` | `1792x768` |
| `16:9` | `1792x1024` |
| `9:16` | `1024x1792` |
| `4:3` | `1024x768` |
| `3:4` | `768x1024` |

---

## 5. 响应解析

图片可能以多种形式返回：
1. `choices[0].message.content` 数组中的 `image_url` 类型
2. Markdown 格式的图片链接 `![](url)`
3. 纯文本 URL

---

## 6. 代码实现

相关文件：[antigravitytools.ts](file:///f:/CodeProjects/ObsidianCanvasAI/src/api/providers/antigravitytools.ts)

核心方法：
- `generateImage()` - 入口，统一调用 `generateImageWithChat`
- `generateImageWithChat()` - 文生图/图生图统一实现
- `buildModelWithSuffix()` - 构建带分辨率/比例后缀的模型名
- `aspectRatioToSize()` - 比例到尺寸的映射
