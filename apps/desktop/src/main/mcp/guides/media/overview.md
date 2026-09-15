# Media generation

Use `media_list_providers` to discover configured providers and model ids when
not already known. Reuse the result within the task unless configuration changes
or a call reports that the provider is unavailable. `sizing` names the one
framing field the image model reads (`"size"` or `"aspectRatio"`); the other is
silently ignored. Honor `sizeNote` and `supportsMask`; unsupported fields may be
ignored rather than rejected.

## Choose the relevant topic

Combine the returned `kind` with the requested media type, for example `ark`
plus video selects `ark-video`. Read that topic for unfamiliar provider options;
there is no need to load manuals for other providers or media types.

| Topic | Covers | Adapter |
|---|---|---|
| `ark-image` | Volcengine/BytePlus Seedream image generation | Hand-written in this repo |
| `ark-video` | Volcengine/BytePlus Seedance video generation | Hand-written in this repo |
| `openai-image` | Dall-E / gpt-image image generation | Official `@ai-sdk/openai` provider, unmodified |
| `openai-video` | Sora video generation | Hand-written in this repo (no first-party SDK video model exists for Sora) |
| `google-image` | Imagen / Gemini image generation | Official `@ai-sdk/google` provider; SuperOne maps `size` tiers (`1K`/`2K`/`4K`) onto `imageConfig.imageSize` for Gemini image models |
| `google-video` | Veo video generation | Official `@ai-sdk/google` provider, unmodified |
| `newapi-video` | Doubao/Kling video generation **via a NewAPI-style relay** | Hand-written in this repo — a completely different wire from `openai-video`, even though both serve video |

A `newapi` video provider uses `newapi-video`, even if the provider picker groups
it under the OpenAI family. Its request format differs from `openai-video`.

## Common contract

- `prompt` describes the requested result. For image edits, supply the source
  files in `reference_image_paths`; video can use them as scene/character references.
- `seed`, size, resolution, and aspect ratio support varies by model. Use the
  provider's reported constraints and relevant topic.
- Video fields `generate_audio`, `watermark`, `camera_fixed`,
  `reference_video_paths`, `reference_audio_paths`, and `fps` are Ark-specific;
  consult `ark-video` before using them.
- Check returned `warnings` for ignored options before claiming the output meets
  the request. Inspect image `previewPaths`; use `savedPaths` for originals.
- Video submission opens SuperOne's parameter approval dialog. After submission,
  poll `media_video_status` about every 30 seconds while running. These calls
  download and save the result; a job id alone is not completion. Stop on error
  or cancellation, and use rejection feedback before proposing a retry.
- Generated media displays automatically. Describe the result without embedding
  it again.
