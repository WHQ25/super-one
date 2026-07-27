# Media Generation — Overview

`media_generate_image` and `media_generate_video` share one settings surface (aspect ratio, size, seed, ...), but **which fields actually do something depends entirely on the provider AND whether you're generating an image or a video** — the same provider's image and video paths can be wired completely differently (one hand-written, the other a stock SDK passthrough). Read this topic first, then read the specific `<provider>-<task>` topic for the call you're about to make, before setting anything beyond `prompt`.

## Available topics

| Topic | Covers | Adapter |
|---|---|---|
| `ark-image` | Volcengine/BytePlus Seedream image generation | Hand-written in this repo |
| `ark-video` | Volcengine/BytePlus Seedance video generation | Hand-written in this repo |
| `openai-image` | Dall-E / gpt-image image generation | Official `@ai-sdk/openai` provider, unmodified |
| `openai-video` | Sora video generation | Hand-written in this repo (no first-party SDK video model exists for Sora) |
| `google-image` | Imagen / Gemini image generation | Official `@ai-sdk/google` provider; SuperOne maps `size` tiers (`1K`/`2K`/`4K`) onto `imageConfig.imageSize` for Gemini image models |
| `google-video` | Veo video generation | Official `@ai-sdk/google` provider, unmodified |
| `newapi-video` | Doubao/Kling video generation **via a NewAPI-style relay** | Hand-written in this repo — a completely different wire from `openai-video`, even though both serve video |

Match the provider `kind` reported by `media_list_providers` (`ark`/`openai`/`google`/`newapi`) with whether you're calling `media_generate_image` or `media_generate_video` to pick the topic — e.g. `kind: "ark"` + `media_generate_video` → read `ark-video`. There is no combined `<provider>` topic anymore — a provider being hand-written for one task (e.g. Ark's video) says nothing about how its other task (Ark's image) is wired, so treat the two as unrelated reads.

**`newapi-video` is not "the openai-video topic but for a relay."** It is a second, unrelated video wire that happens to also live under the `openai` family in the provider picker (both address the same relay base URL, just different sub-paths) — a `kind: "newapi"` provider needs `newapi-video`, not `openai-video`, even though both ultimately point at an OpenAI-compatible-flavored relay. Get this wrong and the request body shape is wrong for every field beyond `prompt`.

## Always start with `media_list_providers`

Don't guess which providers/models are configured. Call it first (filter with `category: "image"` or `"video"` if you know which you need). For each usable provider it returns:

- `sizing`: `"size"` or `"aspectRatio"` — which one that provider's image model actually reads. Passing the other one does nothing (or triggers a warning) rather than erroring.
- `sizeNote`: provider-specific size constraints when the generic guidance doesn't apply (e.g. Ark's Seedream models reject anything under ~3.7 megapixels).
- `supportsMask`: whether inpainting is wired up (currently openai only, and only through the underlying SDK's edit prompt shape).
- `models`: the actual model ids to pass as `model`.

## How this repo is wired (so you know what's real vs. what's the vendor's raw API)

Both tools resolve a model, then hand it to one generic AI SDK entry point (`generateImage` / `experimental_generateVideo`) that speaks a single vendor-neutral options shape. `ark-image`, `ark-video`, and `openai-video` are **hand-written adapters in this repo** that translate that shape onto the vendor's real HTTP API — those topics document the translation, including provider quirks that would otherwise fail silently. `openai-image`, `google-image`, and `google-video` call the vendor's **official AI SDK provider package directly** with no custom adapter in between, so the vendor's own API semantics apply as-is (see the "Adapter" column in the table above).

## Fields that mean the same thing everywhere (when supported)

| Field | Image tool | Video tool | Notes |
|---|---|---|---|
| `prompt` | ✅ | ✅ | Always used. |
| `reference_image_paths` | ✅ (edit / image-to-image) | ✅ (character/scene reference) | On the image tool this works for **every** provider, not just ones with a dedicated edit endpoint — it rides the AI SDK's `{ text, images }` prompt shape, which `generateImage` translates per-provider. |
| `seed` | ✅ | ✅ | Only some providers honor it — see the per-provider topic. |
| `aspect_ratio` | provider-dependent | provider-dependent | See `sizing` from `media_list_providers` for images. For video it's more provider-dependent still — read the topic. |
| `size` / `resolution` | provider-dependent | provider-dependent | Same caveat. |

## Fields that only exist for one provider

These are in the video tool schema because Ark (Volcengine Seedance) needs them, and are ignored or warned-away by everyone else: `generate_audio`, `watermark`, `camera_fixed`, `reference_video_paths`, `reference_audio_paths`, `fps`. Read `ark-video` before using any of these.

## Reading `warnings`

Both tools return a `warnings` array in their result when a setting you passed isn't supported by the resolved provider/model. **Read it** — a value being silently ignored instead of erroring is the normal failure mode here (loose validation is common in these APIs), not a bug. If you're not sure whether a field applies before calling, check the per-provider topic instead of finding out from a warning after the fact.
