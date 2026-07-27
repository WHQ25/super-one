# Google image (Imagen / Gemini image) — official AI SDK provider, `google.image(modelId)`

Uses `@ai-sdk/google` unmodified for the HTTP call. SuperOne only translates the tool's `size` tier onto `providerOptions.google.imageConfig.imageSize` for Gemini image models (see below). If something behaves unexpectedly, check the `warnings` in the tool result first, then consult Google's own docs — don't assume this repo's other providers' quirks carry over here.

| Tool arg | Behavior |
|---|---|
| `aspect_ratio` | Primary framing knob (`media_list_providers` reports `sizing: "aspectRatio"`). One of `1:1`, `3:4`, `4:3`, `9:16`, `16:9` (Gemini image models may accept a wider set; stick to these unless you know the model). |
| `size` | **Gemini image models** (`gemini-*-image*`): pass a resolution **tier** — `"1K"`, `"2K"`, `"4K"`, or `"512"`. SuperOne maps this to `providerOptions.google.imageConfig.imageSize` and co-locates `aspect_ratio` on the same `imageConfig` so the SDK does not drop the ratio. **Imagen models** ignore `size` (no pixel-size or tier parameter on the predict path) — use `aspect_ratio` only. Pixel sizes like `"1024x1024"` are not supported on either family and produce an `unsupported` warning. |
| `reference_image_paths` | Works on **Gemini image** models (image editing / image-to-image via the generateContent path). **Likely doesn't do anything useful on Imagen** — the AI SDK's Imagen path is text-to-image only and errors if files are supplied. Prefer Ark or OpenAI when you need editing on non-Gemini Google models; check `warnings` / the raw error rather than assuming it worked. |
| `seed` | Not confirmed either way for Imagen — treat as best-effort. Gemini image models may honor it via the language-model path. |

Other Google knobs (`personGeneration`, grounding, etc.) exist under `providerOptions.google` on the underlying SDK call but are **not** threaded through `media_generate_image`'s schema.
