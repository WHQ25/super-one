# Ark image (Volcengine / BytePlus ModelArk — Seedream) — `POST /images/generations`

Hand-written adapter (`apps/desktop/src/main/media-gen/ark/`) because Ark's wire format doesn't match the generic AI SDK shape.

| Tool arg | Ark field | Notes |
|---|---|---|
| `prompt` | `prompt` | |
| `size` | `size` | `"2K"`, `"4K"`, or an explicit `"WxH"`. **Seedream rejects anything under ~3.7 megapixels** — `"1024x1024"` fails. Omit to use the `"2K"` default. |
| `aspect_ratio` | — | **Not supported.** Ark sizes images via `size` only; passing `aspect_ratio` produces an `unsupported` warning and is dropped. |
| `reference_image_paths` | `image` (string or string[]) | Image-to-image / editing. Up to 14 reference images; extras are dropped with a warning. |
| `seed` | `seed` | Passed through as-is. |

There is no separate edit/inpaint endpoint — Ark serves image-to-image from the same `/images/generations` call via the `image` field, which is why the generic `openai-compatible` model 404s if pointed at an Ark endpoint (it expects a real `/images/edits` route).
