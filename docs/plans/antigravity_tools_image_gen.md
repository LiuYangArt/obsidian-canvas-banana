# Antigravity Manager Image Generation Analysis

## 1. 核心结论

Antigravity-Manager **主要通过 OpenAI 兼容接口 (`/v1/images/generations`) 提供图像生成服务**。

虽然它支持 Gemini 原生协议 (`/v1beta/models/...`)，但图像生成的特定逻辑（如设置 `requestType: "image_gen"` 和构建内部 API 载荷）主要在 **OpenAI Handler** 中实现。

底层調用的是 **Google Internal API (`cloudcode-pa.googleapis.com/v1internal`)**，而非公开的 `generativelanguage.googleapis.com`。这意味着它伪装成 Google Cloud Code 插件进行请求。

## 2. 如何正确调用 (最佳实践)

推荐使用 **OpenAI 兼容 API** 进行调用，因为这是目前代码中适配最完善的路径。

### 接口详情
- **Endpoint**: `POST /v1/images/generations`
- **Headers**:
  - `Authorization`: `Bearer <your-token>` (实际上是通过 Antigravity 的 TokenManager 管理的 token)
  - `Content-Type`: `application/json`

### 支持参数映射

| OpenAI 参数 | 默认值 | 说明 / 映射逻辑 |
| :--- | :--- | :--- |
| `model` | `gemini-3-pro-image` | 也支持其他在模型映射中配置的模型 ID |
| `prompt` | (必填) | 提示词 |
| `n` | `1` | 生成数量 (通过并发请求实现，Google 底层限制单次1张) |
| `size` | `1024x1024` | **关键映射**: 映射为 Gemini 的 `aspectRatio`<br>- `1024x1024` -> `1:1`<br>- `1792x1024`, `1920x1080` -> `16:9`<br>- `1024x1792`, `1080x1920` -> `9:16`<br>- `1024x768`, `1280x960` -> `4:3`<br>- `768x1024`, `960x1280` -> `3:4` |
| `response_format`| `b64_json` | 返回 Base64 编码的 JSON |
| `quality` | `standard` | 设为 `hd` 时，Prompt 会自动追加 `(high quality, highly detailed, 4k resolution, hdr)` |
| `style` | `vivid` | **vivid**: 追加 `(vivid colors, dramatic lighting, rich details)`<br>**natural**: 追加 `(natural lighting, realistic, photorealistic)` |

### 示例 Payload

```json
{
  "model": "gemini-3-pro-image",
  "prompt": "A futuristic city with flying cars",
  "n": 1,
  "size": "1792x1024",
  "quality": "hd",
  "style": "vivid",
  "response_format": "b64_json"
}
```

## 3. 关于 Gemini 原生 API 支持

- 项目中确实存在 Gemini 原生接口处理 (`src-tauri/src/proxy/handlers/gemini.rs`)，路径为 `/v1beta/models/:model:generateContent`。
- **但是**，`openai.rs` 中的 `handle_images_generations` 显式构造了一个特殊的请求体，包含 `requestType: "image_gen"` 和嵌套的 `generationConfig`。
- 原生 Handler (`gemini.rs`) 主要是透传请求，并未看到针对 Image Generation 的特殊 payload 构造逻辑。因此，如果直接使用原生 Gemini 图像生成协议调用 `/v1beta/models/...`，除非手动构造出符合其内部 `v1internal` 要求的特殊 JSON 结构（包含 `requestType: "image_gen"`），否则可能会失败或被识别为普通文本对话。

## 4. 底层实现细节

- **API Endpoint**: `https://cloudcode-pa.googleapis.com/v1internal:generateContent`
- **Request ID**: 自动生成 `img-{uuid}`
- **User Agent**: 强制设置为 `antigravity`
- **Safety Settings**: 默认全部设置为 `OFF` (BLOCK_NONE)，允许生成更多内容。
