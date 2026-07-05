# SuperOne 接入 AI 生成媒体（生图/生视频）— 以 AI SDK 抽象为核心

## 背景与目标

SuperOne 要接入「AI 生图/生视频」能力，该能力**同时被 coding agent（工具调用）和人类用户（UI）使用**。本文档设计生图部分，视频为后续扩展。

**核心原则**：既然采用 Vercel AI SDK，架构就**以 AI SDK 的统一抽象为第一接口，而非为 OpenAI / Google 两家定制**。`gpt-image-2` 与 Nano Banana 只是**首批被配置进来的 provider 示例**，不是设计的中心。判断标准：新增第三家（fal / replicate / luma / bedrock…）应该**只加配置 + 装一个 `@ai-sdk/*` 包**，核心代码几乎不动。

## 设计原则

1. **media-gen 是 AI SDK 之上的薄编排层**：核心只做四件与厂商无关的事 —— 解析 provider 配置 → 调 `generateImage` → 落盘 → 写历史。wire 格式、图生图/编辑、size/aspectRatio 翻译，全部由 AI SDK provider 内部消化。
2. **provider = 数据，不是代码**：一个 provider 由「`kind`（对应某个 `@ai-sdk/*` 包）+ credentials + baseURL + 可用 model 列表」描述。首批 `openai` / `google` 只是这张表里的两行。
3. **参数透传 + warnings，不预先 gate**：不维护「哪个模型支持 size/mask/n」的硬编码表。把调用方给的参数透传给 `generateImage`，用 AI SDK 原生的 `result.warnings` 承接「本模型不支持某参数」，回传给调用方/UI。核心因此对模型能力差异**零知识**。
4. **厂商特定旋钮走 `providerOptions` 透传**：如 OpenAI 的 `quality`、Gemini 的 `googleSearch`/`imageSize` —— 作为不透明的 `providerOptions` 传下去，核心不认识它们，UI/preset 层才知道。
5. **命名 `media-gen` + `media_type` 字段**：视频（AI SDK 后续的 `generateVideo` 或 gateway）只是多一种 kind/media_type，不返工。

## 架构

```
apps/desktop/src/main/media-gen/
  registry.ts    PROVIDER_KIND_FACTORIES: kind -> (cfg) => AI SDK provider
                 —— 唯一知道具体 @ai-sdk/* 包的文件；扩展 = 加一行 + 装包
  service.ts     generateMedia(params): 解析 provider -> generateImage 透传 -> 落盘 -> 历史 -> {images, warnings}
  types.ts       GenerateMediaParams / MediaResult / MediaProviderConfig（全部 provider-agnostic）
  storage.ts     bytes 原子落盘（复用 image-cache 的 writeCache/detectImageMime）
  keys.ts        safeStorage 加密读写 key（复用 mcpb-secrets 范式）
apps/desktop/src/main/db-media-generations.ts   media_generations 表 CRUD（照抄 db-sessions）
```

所有消费方（agent 工具 / 配置 UI / 工作台）**只调 `service.generateMedia`**。service 是唯一真源，也是「agent + 人类共用」的物理交点。

### registry.ts —— 唯一的厂商耦合点，且被压到最薄

```ts
import { createOpenAI } from '@ai-sdk/openai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'

// kind -> 如何用一份运行时配置构造 AI SDK provider
export const PROVIDER_KIND_FACTORIES: Record<string, (cfg: MediaProviderConfig) => any> = {
  openai:              cfg => createOpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL }),
  google:              cfg => createGoogleGenerativeAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL }),
  'openai-compatible': cfg => createOpenAICompatible({ name: cfg.id, apiKey: cfg.apiKey, baseURL: cfg.baseURL! }),
  // 扩展 fal / replicate / luma / bedrock：装 @ai-sdk/<x> 后在此加一行
}

export function resolveImageModel(cfg: MediaProviderConfig, modelId: string) {
  const factory = PROVIDER_KIND_FACTORIES[cfg.kind] ?? throwUnknownKind(cfg.kind)
  const provider = factory(cfg)
  return provider.image?.(modelId) ?? provider.imageModel(modelId)  // 两种命名都兼容
}
```

> 这是整个模块**唯一**出现具体厂商名的地方。加 provider 不改 service，只改这张表。

### service.ts —— 与厂商无关的透传 + warnings

```ts
import { experimental_generateImage as generateImage } from 'ai'

export async function generateMedia(p: GenerateMediaParams): Promise<MediaResult> {
  const cfg = resolveProviderConfig(p.providerId)     // 读配置 + key
  const model = resolveImageModel(cfg, p.model)

  // 有参考图 => 结构化 prompt（图生图/编辑/改上一张）；否则纯文本。AI SDK 内部翻译各家 wire。
  const prompt = p.referenceImages?.length
    ? { text: p.prompt, images: p.referenceImages.map(r => r.data), ...(p.mask ? { mask: p.mask } : {}) }
    : p.prompt

  const id = randomUUID()
  try {
    const res = await generateImage({
      model, prompt,
      size: p.size, aspectRatio: p.aspectRatio, n: p.n,   // 透传，不 gate
      providerOptions: p.providerOptions,                 // 厂商特定旋钮，不透明透传
      abortSignal: p.abortSignal,
    })
    const saved = await persistImages(res.images, p.sessionId, id)
    insertMediaGeneration({ id, status: 'succeeded', provider_id: p.providerId, model: p.model,
      params_json: JSON.stringify({ size: p.size, aspectRatio: p.aspectRatio, n: p.n, edited: !!p.referenceImages?.length }),
      warnings_json: JSON.stringify(res.warnings ?? []), result_paths_json: JSON.stringify(saved.map(s => s.path)), ... })
    return { generationId: id, images: saved, warnings: res.warnings ?? [], providerMetadata: res.providerMetadata }
  } catch (e) {
    insertMediaGeneration({ id, status: 'failed', error: String(e), ... }); throw e
  }
}
```

### types.ts —— provider-agnostic 契约

```ts
export interface MediaProviderConfig { id: string; kind: string; apiKey: string; baseURL?: string; models: string[] }
export interface GenerateMediaParams {
  providerId: string; model: string; prompt: string
  referenceImages?: { mimeType: string; data: Uint8Array }[]   // 图生图/编辑
  mask?: Uint8Array
  size?: string; aspectRatio?: string; n?: number
  providerOptions?: Record<string, unknown>                    // 厂商特定，透传
  sessionId?: string; source: 'agent' | 'human'; abortSignal?: AbortSignal
}
export interface MediaResult {
  generationId: string
  images: { path: string; mimeType: string; base64: string }[]
  warnings: unknown[]; providerMetadata?: unknown
}
```

## 依赖

`apps/desktop/package.json` 新增：`ai`、`@ai-sdk/openai`、`@ai-sdk/google`、`@ai-sdk/openai-compatible`（首批三种 kind）。纯 JS，无原生依赖，electron-vite 直接打包。装完锁定版本号（`generateImage` 的编辑结构 + `.image()` 为较新特性）。

## 数据表 `media_generations`（provider-agnostic）

`database-migrations.ts` 尾部追加幂等 `CREATE TABLE IF NOT EXISTS`（照抄 `automations` 表），新建 `db-media-generations.ts`（照抄 `db-sessions.ts`）：

```
id, session_id, project_id, source('agent'|'human'), provider_id, model, media_type('image'|'video'),
prompt, params_json, warnings_json, result_paths_json, status('succeeded'|'failed'), error, created_at
```

索引 `idx_media_gen_session(session_id)`。ID `randomUUID()`，时间戳 ISO 字符串。**无 provider 专属列** —— 差异全落在 `params_json`/`warnings_json`。

## 落盘与路径白名单

- 输出根 `join(userData, 'media-gen')/<sessionId|adhoc>/<id>-<i>.<ext>`，原子写复用 `image-cache.ts` 的 `writeCache`/`detectImageMime`。
- **硬约束**：`userData` 不在 media-server / path-security 白名单（默认 403）。chat 回显走 `window.app.readFileAsDataUri`（IPC 直读，不过白名单）；为让 agent 的 `Read` 工具与 media-server 也能读原图，在 `path-security.ts` 的 `getReadableAssetRoots` `extraRoots` 加入该根（一处小改）。

## 密钥

复用 `mcpb-secrets.ts` 的 `safeStorage` 范式，落 `join(userData,'media-gen','keys.bin')`，`values = { [providerId]: apiKey }`。

## provider 解析

`resolveProviderConfig(providerId)`：**P0/P1 验证期**从 env（`OPENAI_API_KEY`/`GEMINI_API_KEY`）+ 内置默认 config 读取（不依赖 UI 即可跑通）；**P3** 切到读 `api_providers`(category=media_gen) + `keys.ts`。

## 消费方路线（都只调 `service.generateMedia`，落点已调研确认）

### P2 — agent 工具（`registerSuperoneTools` 内，`superone-mcp-builtins.ts`）

- `server.registerTool('generate_image', {...}, handler)`，读 `deps.sessionId` → `generateMedia({ source:'agent', ... })`。
- **返回图像 content block 让 agent 看图迭代**：`{ content:[{type:'image',data:base64,mimeType},{type:'text',text:JSON({savedPath,generationId,warnings})}] }`（现有工具无先例，用 MCP 标准形态）。
- 注册：`superone-mcp-builtin-defs.ts` 的 `BUILT_IN_SUPERONE_TOOL_NAMES` + `_DEFS` + 描述常量（`generate_image` 免权限确认）。
- **chat 回显**（`tool_result` 只带 summary 不带 bytes）：`ToolBlock.tsx` 加 `mcpToolName==='generate_image'` 分支，从 result JSON 取 `savedPath`，渲染新 `GeneratedImageBlock`（复用 `codex-image-shared.tsx` 的 `useImageDataUri`/`ImageInteractive`/`CodexImageViewer`，镜像 `CodexImageGenerationBlock.tsx`）。

### P3 — provider 配置 UI（复用 `api_providers`，`category='media_gen'`）

- 表单**围绕通用 provider 概念**（kind + baseURL + key + model 列表），不是「OpenAI 表单/Gemini 表单」。
- 耦合点：`ProvidersPage.tsx` 按 `supported_agents.includes(claude/codex)` 过滤 → media_gen 用哨兵 `supported_agents='["media_gen"]'` + 独立分区避污染。`ProviderDialog.tsx` 加 `category==='media_gen'` 分支表单；`provider-presets.ts` 的 `ProviderCategory` 加 `'media_gen'`，OpenAI/Gemini 作为**预设条目**（数据）。

### P4 — 人类工作台（canvas 原生 React 面板，无 host layer）

- `stores/mediagen.ts`（照抄 `stores/browser.ts` 极简 open 标志）+ `CanvasPanel.tsx` 加一路 `return <MediaGenWorkbench/>`。
- 入口：`ChatInput.tsx` 的 `selectSlashCommand` 加 `/image` 本地拦截（照抄 `provider` 分支）或工具栏按钮。
- 画廊读 `media_generations`；参考图拖入复用 `AttachmentBar`/`image-compress.ts`；model 下拉来自 provider config 的 `models`。

## 首批 provider（附录：示例配置，非架构的一部分）

作为 `provider-presets.ts` 里的数据条目落地，说明「怎么把一家接进来」：

| kind | provider 实例 | model 示例 | 厂商特定 providerOptions |
|---|---|---|---|
| `openai` | OpenAI | `gpt-image-2` | `{ openai: { quality:'high' } }`；size WxH；支持 mask/n |
| `google` | Gemini | `gemini-3.1-flash-image`、`gemini-2.5-flash-image` | `{ google: { imageSize:'2K', googleSearch:{} } }`；用 aspectRatio |
| `openai-compatible` | 中转/聚合网关 | 由网关决定 | baseURL 指向网关 |

- **Nano Banana Pro `gemini-3-pro-image`**：AI SDK 文档仅见 `interactions()+generateText` 示例，`google.image()` 是否可用未证实 → 用 spike 实测；可用则加进 google 预设的 models，不可用则该模型暂不列入（不影响架构）。
- **图生图/编辑差异**：openai 支持 mask、google 不支持 —— **不在核心 gate**，调用方传 mask 时 google 会在 `res.warnings` 里报告，UI 据此提示。核心保持通用。

## 分期

- **P0**：装依赖 + `registry`/`service`/`types`/`storage`/`keys` 骨架 + `media_generations` 表 + path-security 白名单。
- **P1**：透传 + warnings 跑通；env key 下验证 openai + google 的文生图 / 图生图 / 中转 baseURL；spike 拍死 Pro 路径。
- **P2/P3/P4**：agent 工具 / 配置 UI / 工作台（各自单独展开）。

## 验证（P0+P1，不依赖 UI）

1. `bun run typecheck:node`。
2. dev spike `apps/desktop/scripts/media-gen-spike.ts`（`bunx tsx`，env 取 key）：openai 文生图→图生图、google 文生图（aspectRatio）、试 `gemini-3-pro-image`、给 google 传 mask 断言 `warnings` 非空、`media_generations` 落行（成功/失败）。
3. 无 key：mock fetch 的 vitest（`apps/desktop` cwd）覆盖透传与失败落库。

## 风险

- AI SDK 版本漂移 → 装完锁版本。
- Pro 模型路径未定 → spike 拍死，不阻塞架构。
- 视频无标准 `generateVideo` → 走 gateway/后续 kind，命名已预留。
- 成本（gpt-image-2 high ~$0.21、Nano Banana Pro 4K ~$0.24/张）→ UI 显示档位，工具默认低档。
