# Mobile file preview and transfer

Chat WebView native requests route HTTPS links, clipboard copies, and stripped remote
file-tool metadata through RN. Every preview — file chip or picture — lands in the one
fullscreen `ui/file-preview.tsx` modal (`FilePreviewModal`, its own `MenuHost`) whose only
chrome is Close, the title, and a **More** menu with *Save to Photos* / *Save to Files* and
*Share*. `file-preview-state.ts` owns the state machine (`loading | image | video | model | text |
transfer | error`) and decides which menu rows are enabled; `media-ports.ts` (`MediaPorts`)
is the only place that performs save/share through `expo-file-system` / `expo-sharing` / `expo-media-library`,
so tests, stories, and the gallery inject `preview/fake-media-ports.ts` instead. Saving to
Photos asks for add-only library permission and surfaces a denied state with an Open
Settings button; saving to Files goes through `Directory.pickDirectoryAsync`.
`previewFile` is the file chip's primary action (with the cited `line` when there is one)
and is owned by `navigation/use-file-preview.ts`: it asks `read_desktop_file` with
`preferInline` + `statOnly` in one trip, shows small text/Markdown inline on every
transport and small binaries (≤512 KiB) inline over the relay (policy in
`@superone/shared/file-preview`), and otherwise enters the `transfer` state — downloading
on its own over LAN, after a Download confirmation over the relay when R2 staging is
required. Downloaded images swap into the image body, downloaded clips into the `video`
body (`ui/video-player.tsx`, `expo-video` with native controls, autoplay, Save to Photos),
and 3D files into the `model` body (`ui/zoomable-model.tsx`). Other files stay on a
"Downloaded" card so the menu can save or share them. The 3D body writes an offline
viewer HTML beside the cached model and gives its WebView read access to that folder.
Its bundled Three.js parser is shared with desktop; orbit, pinch zoom, pan, reset and
model animations work offline. Models save to Files or share. A glTF file with external
buffers or textures needs a self-contained GLB for phone preview, because only the
selected file transfers. `build:chat-view` regenerates the gitignored viewer HTML.
`expo-video`
is native — pulling it in needs a dev-client rebuild — and jest stands it in from
`jest.setup.ts` (a source containing `missing` reports `status: 'error'`). `openFile` is the secondary action: resolve the path against the active project and
open the containing directory. The native file browser uses `previewFile` for file rows;
directory rows navigate only. Remote path helpers must preserve POSIX roots, Windows drive
roots, and UNC share roots. Coalesce concurrent reads of the same project/session/path
until the first request settles. Unsupported actions must return an error response, never
`{ ok: true }`. The text body's code listing is highlighted by `ui/code-highlight.ts`
(lowlight `common` grammars, GitHub palettes per scheme); grammar is chosen from the file
name only, and unknown or >128 KiB files render plain.
`loadImage` is how tool screenshots and generated images get onto the transcript: the
WebView's `PortableHostImage` asks for a path, `inline-images.ts` answers with a data URI
over LAN and for relay files small enough to ride the RPC (≤512 KiB). Larger relay files
answer `confirmRequired` (+ size from a `statOnly` read) until the request carries
`confirmed: true` — the row shows a Load button in between.
Decoded images are cached per project/path (48 MiB LRU) so re-mounted rows never re-fetch.
A video in the transcript — a generated clip's gallery tile or a markdown `![…](clip.mp4)` —
is `PortableHostVideo`: it asks `loadVideoPoster` → `read_video_poster` for the first frame,
which the desktop cuts in a hidden offscreen window streaming from its media server
(`apps/desktop/src/main/remote/video-poster.ts`, disk-cached under userData) and always
answers in-band, so there is no relay confirmation for a poster. `video-posters.ts` caches
the answer per project/path, `null` included. Tapping the tile is `previewFile`: the clip
itself only moves then.
Tapping any picture the transcript *displays* — a loaded host image, a user attachment, a
markdown image — sends `previewImage` with the `src` already painted, and the shell opens
the same modal in its `image` state: a pinch/double-tap viewer over the same bytes, whose
menu saves to Photos or shares from the cache. It never re-downloads (remote `http(s)`
sources have both rows disabled). The picture fills the screen under the title row; a tap
hides the row and the status bar. On Android the modal is its own dialog window,
which RN's `StatusBar` never reaches after it opens, so `ui/window-status-bar.tsx` goes
through the Android-only `modules/window-status-bar` view instead. `previewFile` remains
the path for a chip *without* a picture yet, and for non-image files.
A *generated* image's tap also carries `generation` (`ImageGenerationInfo`: prompt, params,
timing, reference paths, warnings — the same shape for Codex-native ImageGen and
`media_generate_image`), which puts an Info button beside the rotate pair. Its panel
(`ui/image-info-panel.tsx`) mirrors the desktop viewer's popover and reaches the host only
through `ImageGenerationPorts` (`image-generation-ports.ts`, built in `use-file-preview`):
`list_media_providers` turns provider/model ids into catalogue names (asked once per
pairing) and `loadImage` fetches reference thumbs unconfirmed — over the relay a large
reference falls back to its file name rather than staging a transfer. Stories and the
`File preview` gallery inject `preview/fake-generation-ports.ts`.
Images and PDFs use the `ImageAttachment` message path. Project file upload uses inline
RPC through 512 KiB, raw LAN PUT when connected locally, or chunk-encrypted relay R2
PUT plus completion through 100 MiB. Picker-reported sizes are optional metadata, not a
security boundary: check `File.size` before reading a whole PDF or project file, then
enforce the exact decoded byte count for base64 image/PDF payloads. Reject missing or
malformed base64 instead of treating it as an empty attachment.
There is no desktop→phone "send file" push: the agent links the file in Markdown and the
chip opens the preview above. Encrypted relay downloads are size-checked, capped at
100 MiB, and written under sanitized cache names (`safeCacheFileName`) before save/share.
