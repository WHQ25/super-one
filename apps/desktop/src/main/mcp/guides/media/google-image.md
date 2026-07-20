# Google image (Imagen) — official AI SDK provider, `google.image(modelId)`

No custom adapter in this repo — `@ai-sdk/google` is used unmodified. If something behaves unexpectedly, check the `warnings` in the tool result first, then consult Google's own docs — don't assume this repo's other providers' quirks carry over here.

| Tool arg | Behavior |
|---|---|
| `aspect_ratio` | The knob Imagen actually reads (`media_list_providers` reports `sizing: "aspectRatio"` for this provider). One of `1:1`, `3:4`, `4:3`, `9:16`, `16:9`. |
| `size` | **Not supported.** Imagen has no pixel-size parameter — use `aspect_ratio`. |
| `reference_image_paths` | **Likely doesn't do anything.** The AI SDK's own Imagen documentation only shows text-to-image usage; it does not document image editing / reference-image input for the `.image()` factory. This repo passes `reference_image_paths` through the same generic `{ text, images }` prompt shape used for every image provider, but nothing confirms Imagen's model implementation actually reads the `images` part of that shape rather than ignoring or erroring on it. If you need image-to-image, prefer Ark or OpenAI, which are confirmed to support it — and if you do try it on Google, check `warnings` (and the raw error, if any) rather than assuming it worked. |
| `seed` | Not confirmed either way for Imagen — treat as best-effort. |

Extra knobs exist under `providerOptions.google.imageConfig` (e.g. `imageSize: "1K"/"2K"/"4K"` on some models) and `providerOptions.google.personGeneration`, but neither is threaded through `media_generate_image`'s schema — they're only reachable if calling the underlying SDK function directly.
