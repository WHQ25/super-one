# OpenAI image (Dall-E / gpt-image) — official AI SDK provider, `openai.image(modelId)`

No custom adapter in this repo — `@ai-sdk/openai` is used unmodified, so whatever that package supports applies as-is.

| Tool arg | Behavior |
|---|---|
| `size` | The knob OpenAI actually reads (`media_list_providers` reports `sizing: "size"` for this provider). Valid sizes are model-specific: `dall-e-3` → `1024x1024`/`1792x1024`/`1024x1792`; `dall-e-2` → `256x256`/`512x512`/`1024x1024`; `gpt-image-1` → `1024x1024`/`1536x1024`/`1024x1536`. |
| `aspect_ratio` | **Not supported.** Dall-E/gpt-image models don't take `aspectRatio` — the SDK reports it as unsupported. Use `size`. |
| `reference_image_paths` | Image-to-image / editing, via the AI SDK's `{ text, images }` prompt shape. |
| `seed` | Model-dependent; not guaranteed to reproduce output. |

`media_list_providers` reports `supportsMask: true` for this provider (the underlying SDK/API supports masked edits), but **the current `media_generate_image` tool schema doesn't expose a mask argument** — only whole-image reference swaps via `reference_image_paths` are reachable today. A masked partial edit isn't available through this tool yet.

Model-specific extras (e.g. `gpt-image-1`'s `quality: "high"`, `background`) go through `providerOptions.openai` if you're calling the underlying SDK function directly rather than the MCP tool — they aren't threaded through `media_generate_image`'s schema.
