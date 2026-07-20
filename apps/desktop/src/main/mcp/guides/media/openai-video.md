# OpenAI video (Sora) — hand-written adapter, `POST /v1/videos`

No first-party AI SDK video model exists for Sora, so this is hand-written (`apps/desktop/src/main/media-gen/video/openai/video-model.ts`) directly against OpenAI's `/v1/videos` API.

| Tool arg | Sora field | Notes |
|---|---|---|
| `prompt` | `prompt` | |
| `resolution` | `size` | **Only** `"720x1280"`, `"1280x720"`, `"1024x1792"`, `"1792x1024"` are accepted. Anything else is dropped with a warning — Sora has no arbitrary-resolution mode. |
| `duration` | `seconds` (as a string) | **Only** `4`, `8`, or `12` seconds — sent as a string enum, not a number. Anything else is dropped with a warning. |
| `aspect_ratio`, `fps`, `seed`, `generate_audio` | — | **None of these are supported.** Sora derives them from the model and `size`. Each produces an `unsupported` warning if set; nothing is sent. |

**`first_frame_path` / `last_frame_path` / `reference_image_paths` are silently ignored for this provider** — the adapter's request body only ever contains `model`/`prompt`/`size`/`seconds`; frame and reference images are never read or sent, and unlike the other unsupported fields above, **no warning is emitted** for this one. If you need image-to-video, use a different provider (Ark or Google) — don't rely on Sora for it.

`n` is unsupported — Sora returns exactly one video per job; a warning is emitted if the SDK-level `n` is ever above 1 (not reachable from the tool, since `media_generate_video` doesn't expose `n`).

`providerOptions.openai` is merged directly into the request body, same escape-hatch pattern as Ark.
