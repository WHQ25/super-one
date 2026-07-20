# Ark video (Volcengine / BytePlus ModelArk — Seedance) — `POST /contents/generations/tasks`

Hand-written adapter (`apps/desktop/src/main/media-gen/video/ark/`), verified against Volcengine/BytePlus's own API reference (`docs.byteplus.com/api/docs/ModelArk` — "Create a video generation task"), not third-party summaries.

Ark's own docs describe **two** ways to pass generation settings, and this repo uses the recommended one:

- **New method (what this repo sends):** top-level JSON fields on the request body, full names only, strict validation (bad values error instead of silently defaulting).
- **Legacy method (not used here):** `--key value` flags appended to the prompt text, loose validation — a typo is silently ignored rather than rejected. Don't reintroduce this; it's why the flag names drifted wrong here before.

| Tool arg | Ark field | Notes |
|---|---|---|
| `prompt` | `content[].text` | |
| `aspect_ratio` | `ratio` | e.g. `"16:9"`. |
| `resolution` | `resolution` | Ark sizes by **tier name**, not pixels: `"480p"`/`"720p"`/`"1080p"`/`"2k"`/`"4k"`. The tool arg still takes a pixel size (`"1920x1080"`); the adapter maps it onto the nearest tier. A resolution that maps to no tier is dropped with a warning — use `providerOptions.ark.resolution` to force a tier directly if you ever call the underlying SDK function instead of the tool. |
| `duration` | `duration` | Seconds, 2–15. |
| `seed` | `seed` | |
| `watermark` | `watermark` (via `providerOptions.ark.watermark`) | Whether to stamp Ark's watermark. |
| `camera_fixed` | `camera_fixed` (via `providerOptions.ark.cameraFixed`) | **Has an underscore on the wire** (`camera_fixed`, not `camerafixed`) — this was wrong in an earlier version of this adapter. |
| `generate_audio` | `generate_audio` | Only Seedance 2.0 series and Seedance 1.5 Pro. Silent video if omitted/false. |
| `reference_video_paths` | `content[]` (`video_url` parts) | Volcengine Ark only. Up to 3 clips, ≤15s combined. |
| `reference_audio_paths` | `content[]` (`audio_url` parts) | Volcengine Ark only. Up to 3 tracks, ≤15s combined. |
| `fps` | — | **Does not exist as an Ark parameter at all** — frame rate is fixed by the model. Setting it produces an `unsupported` warning; nothing is sent. |

Frame images (`first_frame_path`/`last_frame_path`) and `reference_image_paths` all count against a shared budget of **9 images total** across every role — frame images are load-bearing (they define the motion endpoints) so they claim the budget first; reference images are dropped first when over the limit.

## Escape hatch

`providerOptions.ark.body` is merged directly into the request body last, overriding any computed field. Use it if Ark adds/renames a parameter before this adapter is updated — check the request body actually sent (or Ark's error message) rather than guessing a new flag name.
