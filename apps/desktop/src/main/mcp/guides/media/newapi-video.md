# newapi-video (New API's generic multi-vendor video relay — Doubao/Kling, via a NewAPI-style aggregator)

This is **not** the same wire as `openai-video` (Sora's own `/videos` shape). New API (`QuantumNous/new-api`, the common self-hosted aggregator behind most "one API key, many models" relays) exposes a **second, separate** video route for models it doesn't proxy 1:1 to a Sora-compatible backend: `POST {baseURL}/video/generations`, taking a normalized body, not Sora's. Verified against the New API Go source (`relay/channel/task/{doubao,kling}/adaptor.go`), not the (stale, inaccurate) third-party doc site — do not trust that site over this file if they disagree.

Hand-written adapter in this repo: `apps/desktop/src/main/media-gen/video/newapi/`. It currently supports exactly two vendors, picked by the `model` id prefix (`doubao-*` / `kling-*`) — any other model id throws rather than silently sending a guessed body shape.

## Shared submit shape

```
POST {baseURL}/video/generations
{ model, prompt, image?, images?, size?, duration?, seconds?, metadata? }
```

`image`/`images` take a URL or data URI, same as a direct Ark or OpenAI call. Vendor-specific settings ride in `metadata` — New API JSON-round-trips `metadata` straight onto that vendor's own native request struct server-side, so the keys below are the vendor's real field names, not a New API invention.

## Doubao (Ark/Seedance, via relay)

| Tool arg | Where it goes | Notes |
|---|---|---|
| `first_frame_path` / `image` shortcut | top-level `image` | |
| `last_frame_path` | — | **Not expressible on this route.** New API's Doubao adapter has no `role` field for images — every image (first frame, references) lands as an unlabeled reference. Dropped with a warning rather than silently sent as just another reference. If you need a real last frame, call Doubao/Ark directly (see `ark-video.md`), not through this relay. |
| `reference_image_paths` | top-level `images` (plural) | |
| `duration` | top-level **`seconds`** (string) | The Doubao adapter reads only `seconds`; the sibling `duration` (int) field is never read for this vendor. Sending the wrong one is a silent no-op, not an error. |
| `aspect_ratio` | `metadata.ratio` | Same field name as a direct Ark call. |
| `resolution` | `metadata.resolution` | Same tier mapping as a direct Ark call (`480p`/`720p`/`1080p`/`2k`/`4k`) — see `ark-video.md`. |
| `seed` | `metadata.seed` | |
| `generate_audio` | `metadata.generate_audio` | |
| `watermark`, `camera_fixed` | `metadata.watermark` / `metadata.camera_fixed` | Same `providerOptions.ark.{watermark,cameraFixed}` namespace a direct Ark call uses — the same tool call works against either. |
| `fps` | — | Doesn't exist for Doubao, same as a direct Ark call. Warned, not sent. |

## Kling (via relay)

| Tool arg | Where it goes | Notes |
|---|---|---|
| `first_frame_path` / `image` shortcut | top-level `image` | Kling only ever reads the **singular** `image` — never `images`. |
| `last_frame_path` | `metadata.image_tail` | Kling has a real field for this (unlike Doubao on this route). |
| `reference_image_paths` | — | **Not supported.** Kling's relay request has no field for multiple references; dropped with a warning. |
| `duration` | top-level **`duration`** (int) | Kling reads only `duration`; the sibling `seconds` (string) field is never read for this vendor — the mirror-image mistake of Doubao's. |
| `resolution` | top-level `size` | Kling derives its own `aspect_ratio` from `size` via a lookup table server-side (`1024x1024`/`512x512`→`1:1`, `1280x720`/`1920x1080`→`16:9`, `720x1280`/`1080x1920`→`9:16`, anything else→`1:1`). |
| `aspect_ratio` | `metadata.aspect_ratio` | Overrides the size-derived lookup when you need a precise ratio rather than the rough table above. |
| `seed`, `fps`, `generate_audio` | — | Kling has none of these parameters. Warned, not sent. |
| `watermark`, `camera_fixed` | not mapped, warned | Ark-only tool args; meaningless for Kling — setting them produces an `unsupported` warning instead of being silently ignored. |

## Response / download

Submission answers in Sora's shape (`{id, task_id, status: "queued", ...}`), but the sibling `GET {baseURL}/video/generations/{id}` route does **not** — it answers in New API's internal envelope, `{"code":"success","data":{...TaskDto}}`, whose `status` is the uppercase task enum (`NOT_START`/`SUBMITTED`/`QUEUED`/`IN_PROGRESS`/`SUCCESS`/`FAILURE`). Poll `GET {baseURL}/videos/{id}` instead: the relay branches to its OpenAI-compatible converter purely on the `/v1/videos/` URI prefix (`relay/relay_task.go#videoFetchByIDRespBodyBuilder`), so that route returns the flat Sora-shaped object regardless of vendor — every task adaptor (doubao, kling, …) implements `ConvertToOpenAIVideo`. Poll it until `status` is `completed`/`failed` (New API normalizes every vendor's own status spelling — Doubao's real `succeeded`, Kling's real `succeed` — into this same `queued`/`in_progress`/`completed`/`failed` set before it reaches the client, so this adapter never sees the vendor-native spelling), then `GET {baseURL}/videos/{id}/content` for the MP4 bytes. The poll response's `metadata.url` field (when present) points at the vendor's own asset URL directly — this adapter deliberately does **not** use it, since it isn't guaranteed valid or reachable for every vendor; the relay's own content-proxy endpoint always is.
