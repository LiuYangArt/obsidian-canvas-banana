# Antigravity Manager 图像生成接口文档

> 本文档记录了 Canvas Banana 插件中 AntigravityTools Provider 的图像生成实现细节。

## 1. 实现概览

AntigravityTools Provider 使用两种端点进行图像生成：

| 场景 | 端点 | 说明 |
| :--- | :--- | :--- |
| **文生图** | `/v1/images/generations` | 纯文本到图像，支持 `size` 参数 |
| **图生图** | `/v1/chat/completions` | 需要传递参考图片，通过模型后缀控制分辨率/比例 |

底层调用的是 **Google Internal API** (`cloudcode-pa.googleapis.com/v1internal`)。

---

## 2. 文生图 (Text-to-Image)

### 端点
```
POST {baseUrl}/v1/images/generations
```

### 请求体
```json
{
  "model": "gemini-3-pro-image",
  "prompt": "A futuristic city with flying cars",
  "n": 1,
  "size": "1792x1024",
  "response_format": "b64_json"
}
```

### 参数映射

| 参数 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `model` | `gemini-3-pro-image` | 图像生成模型 |
| `prompt` | (必填) | 提示词 |
| `n` | `1` | 生成数量 |
| `size` | `1024x1024` | 尺寸，自动映射为 `aspectRatio` |
| `response_format` | `b64_json` | 响应格式 |

### Size 到 AspectRatio 映射

| size | aspectRatio |
| :--- | :--- |
| `1024x1024` | `1:1` |
| `1792x1024` | `16:9` |
| `1024x1792` | `9:16` |
| `1024x768` | `4:3` |
| `768x1024` | `3:4` |

---

## 3. 图生图 (Image-to-Image)

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

### 模型后缀控制

通过模型名后缀控制分辨率和比例：

| 后缀 | 说明 | 示例 |
| :--- | :--- | :--- |
| `-4k` 或 `-hd` | 4K 分辨率 | `gemini-3-pro-image-4k` |
| `-16x9` | 16:9 比例 | `gemini-3-pro-image-16x9` |
| `-9x16` | 9:16 比例 | `gemini-3-pro-image-9x16` |
| `-4x3` | 4:3 比例 | `gemini-3-pro-image-4x3` |
| `-3x4` | 3:4 比例 | `gemini-3-pro-image-3x4` |

可组合使用：`gemini-3-pro-image-4k-16x9`

> [!WARNING]
> `-2k` 后缀目前不被 Antigravity-Manager 支持（已提交 Issue）。

---

## 4. 响应解析

### /v1/images/generations 响应
```json
{
  "created": 1713833628,
  "data": [{ "b64_json": "..." }]
}
```

### /v1/chat/completions 响应

图片可能以多种形式返回：
1. `choices[0].message.content` 数组中的 `image_url` 类型
2. Markdown 格式的图片链接 `![](url)`
3. 纯文本 URL

---

## 5. 代码实现

相关文件：[antigravitytools.ts](file:///f:/CodeProjects/ObsidianCanvasAI/src/api/providers/antigravitytools.ts)

核心方法：
- `generateImage()` - 入口，根据是否有参考图片选择端点
- `generateImageWithImagesApi()` - 文生图
- `generateImageWithChat()` - 图生图
- `buildModelWithSuffix()` - 构建带后缀的模型名
