# Inline files previewer (`@native/files-previewer`)

Status: **implemented (phases 1–3, desktop + phone, local and remote-node
sessions)** — designed 2026-09-13, phase 3 built 2026-09-14 on top of
`session-sync-zone.md` phases 1–4. The design was revised five times on the
day it was written: after a first Codex design review, after scoping the card
to "stage, not workspace", after switching the trigger from a Markdown table to
a `widget_show` native template, after deciding remote-node support rides on
the session sync zone, and after a second Codex review of that version.
Deviations from the design as written are listed in §8.
Scope: a chat block that shows N files as a fixed-height carousel with a note
per file, on desktop (`apps/desktop`) and on the phone (`packages/chat-view`
+ `apps/mobile`). Sibling docs: `session-sync-zone.md` (remote-node artifact
contract this depends on for remote sessions), `mobile-markdown-media.md`
(why the phone never streams media inline — note its "no inline media" claim
predates `NativeImage` / `PortableHostVideo` and is stale),
`mobile-progressive-session-loading.md`.

Decisions already taken with the user (2026-09-13):

- **Trigger is a tool call, not Markdown**: `widget_show({ template:
  '@native/files-previewer', data })`. A Markdown-table contract was designed
  first and dropped — see §10 for why.
- `note` is **plain text**, no inline Markdown.
- **The card is a stage, not a workspace.** It offers only what is needed to
  read the file through — scroll for text-class files, play/pause for media —
  and nothing else: no zoom, no pan, no selection menus, no download, no page
  navigation. Every further action happens after a tap, and that tap is the
  same on both platforms: desktop opens the previewer's fullscreen, the phone
  opens its **existing** file preview (`FilePreviewModal`) for that one file.
- The desktop fullscreen has **no "open in panel" button**; clicking the file
  chip in its header opens the file in the activity panel, same as `FileChip`.
- Remote sessions: **no per-file origin.** Desktop artifacts reach the agent
  already rewritten to node paths by the sync zone; the previewer only ever
  sees node paths in a remote session.

---

## 1. Motivation

An agent that touched five files today has two ways to show them: five separate
`![](…)` / file links (one preview at a time, no narrative), or a plain table
(no preview at all). Neither lets it say "here are the artifacts, look at each
one, this is why it matters". The previewer is that surface: one block, N files,
one note per file, swipe or arrow through them, tap for the real viewer.

Every harness inside SuperOne already inherits `widget_show` through the
built-in MCP server, and the `@native/` namespace already exists for exactly
this shape of feature: "render one of SuperOne's own surfaces instead of a
frame" (`packages/shared/src/generative-ui/native-widgets.ts`). The previewer
is the third native template after `image-gallery` and `video-gallery`.

## 2. Tool contract

### 2.1 Agent-facing input

```ts
widget_show({
  title: 'changed_files',                // existing required field
  template: '@native/files-previewer',
  data: {
    files: [
      { path: 'docs/design/architecture.png', note: 'Three layers, arrows are IPC direction' },
      { path: 'src/renderer/components/chat/FilesPreviewer.tsx', note: 'New block entry point' },
      { path: '/abs/path/reports/q3-summary.pdf' },
    ],
  },
})
```

- `files[].path`: relative to the session's working directory, or absolute,
  exactly as the agent has it. No escaping rules — it is JSON.
- `files[].note`: optional plain text.
- Limits, enforced by the host: 1–50 files, `note` ≤ 500 chars, total
  payload ≤ 16 KiB. Above that → `isError` naming the limit. The limits exist
  because the result has to survive every harness's tool-result path (§2.3).

Discovery: one entry in `NATIVE_TEMPLATE_CATALOG`
(`apps/desktop/src/main/generative-ui/native-widget-payload.ts:26`), which
`widget_list_templates` prints, plus one clause in the `widget_show`
description. That description exists in **three** copies —
`generative-ui/mcp-server.ts:133`, `mcp/superone-mcp-tool-surface.ts:62` and
the remote-node catalog `packages/shared/src/environment/host-action-superone-descriptors.ts:2332`
— and a drift test asserts they match. Wording is gated on purpose, not on
availability: "when you hand the user several artifacts to look at, one after
another".

### 2.2 Host-built payload (the tool result)

`executeNativeWidget` (`mcp-server.ts:37`) already routes `@native/*` to
`buildNativeWidgetPayload`; the builder gains a `files-previewer` branch. The
payload follows the native-widget principle — **it carries already-resolved
render items, so the renderer never guesses**:

```ts
export type PreviewerFileKind =
  | 'image' | 'pdf' | 'video' | 'audio' | 'markdown' | 'notebook' | 'text'
  | 'unpreviewable'   // binary sniff, too-large, or outside every readable root
  | 'missing'         // stat failed

export interface PreviewerFile {
  path: string          // as the agent wrote it (shown in the header)
  absolutePath: string  // host-resolved; what every read / open uses
  name: string          // basename
  kind: PreviewerFileKind
  size?: number         // bytes; absent when missing
  note?: string
}

// NativeWidgetPayload gains:
//   nativeType: 'files-previewer'
//   root: string              // session root the paths were resolved against:
//                             // a local directory, or a remote:<connectionId>:<path> key
//   files?: PreviewerFile[]   // present only for files-previewer; images/videos absent
```

Builder rules:

- **Resolve against the session's `cwd`, not `projectPath`.** `Session.cwd`
  is the directory the agent works in (a worktree after `session.setCwd`),
  `projectPath` is the project identity (`session/session.ts:183-194,
  510-511`). The existing widget surface reads `projectPath`
  (`superone-mcp-tool-surface.ts:176`) and the HTTP MCP transport freezes it
  at registration (`superone-mcp-stdio-ipc.ts:270-274`); both are wrong for
  this template. The builder receives a `resolveSessionContext(sessionId)`
  callback that reads the live `cwd` at call time, for the in-process Claude
  handler, the HTTP transport and the Host Action path alike.
- Relative paths must stay inside `cwd`; absolute paths are accepted if they
  lie under a root the media server can serve (`media-readable-roots.ts:18-34`:
  recent folders, worktrees, media-gen, capture and sync-zone roots) —
  otherwise `unpreviewable` with reason `outside_readable_roots`. A file the
  builder can stat but the media server would 403 is not previewable, and
  the builder must not widen the allowlist to make it so.
- `stat` each file. Missing → `kind: 'missing'`, keep the row (count and order
  match what the agent wrote). Kind by name via the shared extension sets
  (§3); for `text`, sniff the first `BINARY_SNIFF_BYTES` with `looksBinary`
  (`packages/shared/src/file-preview.ts`) and apply the host's existing
  too-large threshold → `unpreviewable`.
- **No file content in the payload.** Bytes are fetched lazily by the
  renderer (§4.3).
- Remote-node sessions. `widget_show` already reaches the desktop as a Host
  Action (`host-action-browser-catalog.ts:121`, executed at
  `host-action-executor.ts:103`), but the local `SessionManager` has no entry
  for a node session UUID (`host-action-executor.ts:24`). The claim carries
  `sessionId` and `turnId` only (`packages/shared/src/environment/host-actions.ts:102-112`),
  so `resolveSessionContext` for a remote session goes
  `EnvironmentHost.getSession(connectionId, sessionId)` (`environment-host.ts:840`)
  for `cwd` / `projectId`, falling back to
  `RemoteEnvironmentGateway.getProject(projectId)` (`:113`) for the root when
  `cwd` is empty. The generic widget dispatcher stays; only the context
  provider differs. `root` becomes the `remote:<connectionId>:<path>` key.
  Stat in a remote session:
  - path under the node sync root → desktop mirror if present, else
    `artifact.stat` on the node (an agent-written report nobody has opened
    yet must not come back `missing`);
  - path inside the node project → `workspace.listDir` of the parent for
    `size` (`artifact.stat` is scoped to the zone and cannot see project
    files);
  - absolute node path outside both → `unpreviewable` (`outside_readable_roots`).
    Never handed to `toRemoteRelativePath` (`remote-file-tree.ts:140`), which
    would splice it into the project.
  - node without `capabilities.syncZone` → any path under what would be the
    zone is `missing`; no shim.

### 2.3 Render-in-place, not turn-end

The two existing native types are collected into the **turn-end gallery** and
their tool row is hidden (`isHiddenToolBlock`,
`packages/chat-view/src/presenters/tool-display.ts:87`, pairs with
`collectGeneratedImages` at `:366`; on the phone Codex reaches the gallery
through `PortableTurnAdapters.tsx:871-873` → `PortableClaudeTool:197-217` →
`PortableToolRow:300` *and* the turn-end collection, so that type already has
two output paths). The previewer is different: it renders **where the call
sits in the turn**, like a code widget does.

- `parseNativeWidgetResult` (`native-widgets.ts:64`) accepts a payload whose
  `files` is non-empty and whose `images` / `videos` are absent. The collect
  functions only read `images` / `videos`, so nothing collects it at turn
  end, and `isHiddenToolBlock` keeps returning `false`. A chat-view test
  locks both: a `files` payload is neither collected nor hidden, and a
  gallery payload still is.
- **Strict `nativeType` dispatch on the phone, in phase 1.**
  `PortableToolRow.tsx:278-301` sends every parseable native payload to
  `PortableNativeGallery`, which treats any non-image type as video
  (`PortableNativeGallery.tsx:72-73`). Extending the parser without touching
  the dispatch would turn the phone's "ordinary tool row" fallback into an
  empty video gallery. So phase 1 adds the guard: unknown / `files-previewer`
  → ordinary row until phase 2 mounts the card.
- Desktop: `ToolBlockPresenter.tsx:498` — before the `WidgetBlock` branch,
  `nativeType === 'files-previewer'` → `<FilesPreviewer payload>`. The
  `allowExpand=false` compact variant (`:485`) shows the compact row with the
  title; failed or denied calls keep the ordinary row because it is the only
  thing that says why.
- Phone (phase 2): `PortableToolRow.tsx:302` dispatches on `nativeType`.
- While the call streams (`status === 'streaming'`) both surfaces show the
  ordinary compact row ("Generating widget…"). The block appears once, whole.
- **Harness result caps.** ACP truncates non-exempt tool results to 4,000
  chars (`acp-event-map.ts:736, 766-780`; `packages/acp/src/tool-result-map.ts:118,
  148-162`) and only recognises `widget_code` as exempt; a 40-file payload
  would arrive as broken JSON. Both exemption points learn to recognise a
  native payload, and the §2.1 limits keep even the largest legal payload
  under the cap as a second line of defence. `remote-content.ts:627` already
  keeps `widget_show` results whole on the mobile wire.

## 3. Supported file types

Exactly the set the activity panel's Preview tab can show. Today that
classification lives in **three** places and they already disagree:

| Where | Notes |
|---|---|
| `apps/desktop/src/renderer/src/components/coding/FilePreview.tsx:21-26` | renderer sets, no dot; video lacks `m4v`; `ogg` is in both video and audio (video wins) |
| `apps/desktop/src/main/index.ts:~3231` (`readProjectFile`) | host sets; a name the host does not classify as media comes back as text/binary |
| `apps/desktop/src/main/environment/remote-file-tree.ts:66` | remote-node classification |
| `packages/shared/src/file-preview.ts:47,100` | `MARKDOWN_EXTENSIONS` / `VIDEO_EXTENSIONS`, private, **with** leading dot |

Phase 1 exports one normalized, dotted set per kind from
`@superone/shared/file-preview` (`IMAGE_EXTENSIONS`, `PDF_EXTENSIONS`,
`VIDEO_EXTENSIONS`, `AUDIO_EXTENSIONS`, `MARKDOWN_EXTENSIONS`,
`NOTEBOOK_EXTENSIONS`, plus `fileKindFromName(name)`) and rewires all three
consumers **and the payload builder** to it. The builder is a fourth
consumer, which makes the single source mandatory rather than nice: a kind the
builder emits must be a kind the host serves and the renderer draws.

| Kind | Extensions | Card stage (desktop) | Allowed interaction in the card |
|---|---|---|---|
| `image` | png jpg jpeg gif webp bmp ico svg | plain `<img>`, `object-fit: contain` | none |
| `pdf` | pdf | `PdfPreview` in a new restricted mode (§4.1) | none |
| `video` | mp4 m4v webm ogg mov | `<video controls controlsList="nodownload nofullscreen noremoteplayback" disablePictureInPicture>` via `toMediaUrl` | play / pause / seek |
| `audio` | mp3 wav flac aac m4a | `<audio controls controlsList="nodownload">` | play / pause / seek |
| `markdown` | md mdx markdown | the chat's own Markdown renderer (`CopyableMarkdown`, non-streaming) | vertical scroll |
| `notebook` | ipynb | `NotebookPreview` | vertical scroll |
| `text` | anything else the host reads as text | `FileWithDiffView` with an empty diff | vertical scroll |
| `unpreviewable` | binary sniff / too-large / outside readable roots | placeholder card (§4.4) | none |
| `missing` | — | error card (§4.4) | retry |

Neither `TextFileEditor` nor `MarkdownEditor` is usable here: both are
editable, both autosave (`TextFileEditor.tsx:33,72`, `MarkdownEditor.tsx:66,141`)
and neither has a read-only mode. The panel's read-only highlighted view is
`FileWithDiffView` (`FilePreview.tsx:361`), which is what the card uses.

## 4. Desktop — inline card

Component: `apps/desktop/src/renderer/src/components/chat/files-previewer/`
(`FilesPreviewer.tsx`, `PreviewerStage.tsx`, `PreviewerFullscreen.tsx`,
`use-previewer-file.ts`, stories, tests). Mounted from `ToolBlockPresenter`
with the parsed payload (§2.3).

### 4.1 Layout

Fixed height **640px** (480px when the chat pane is narrower than 512px — a
floating panel or a tight split), three bands. The card has no border and no surface of
its own — it sits directly on the chat background like a paragraph; only the
stage is a rounded `bg-muted/30` well:

```
  [icon] docs/design/architecture.svg            1 / 7  [⤢]
╭─ stage (flex-1, rounded, bg-muted/30) ─────────────────────╮
│  (‹)              rendered file               (›)          │
╰────────────────────────────────────────────────────────────╯
                 note text, 13px muted, centered
                      ● ─ ● ● ● ● ●
```

- Header: `FileIcon` + `path` in mono (ellipsis from the left so the basename
  stays visible) + `n / N` (tabular nums) + fullscreen button. No kind badge —
  the icon and the extension already say it.
  The path is a `FileChip`-style button: click → `openFileTab`. `openFileTab`
  stores only a path (`activity-panel-api.ts:255-287`) and `FilePreview`
  resolves it against the *current* effective root (`FilePreview.tsx:35,84`),
  so two nodes with `/srv/app/report.png` would open the wrong one; the chip
  passes `{ root, path }` and `openFileTab` gains a root-aware overload.
  Local sessions are unaffected.
- Stage: the file, centered. Arrows are absolute, vertically centered, hidden
  until hover (`group-hover`), disabled at the ends. **Clicking the stage
  opens fullscreen.** Passivity is enforced structurally, not by attribute
  lists: the stage content is wrapped in `pointer-events: none` (so Markdown
  links, code copy buttons, nested media and text selection are all inert)
  inside a scroll container that keeps pointer events (so wheel / trackpad
  scroll still works). Media stages are the one exception — the element
  keeps pointer events so native play/seek works, and a click on its control
  bar does not open fullscreen. `PdfPreview` today renders every page with a
  zoom toolbar (`PdfPreview.tsx:14, 37-50, 128-143`); it gains a
  `variant="stage"` that renders page 1 fitted to the container with no
  toolbar — a real work item, listed in phase 1.
- Footer: note (2-line clamp, centered, full text on hover title), then dots.
  Dots are clickable. With one file: no arrows, no dots, no counter.

Why fixed height: the block sits inside a transcript; a carousel whose height
changes per file would shift everything below it on every switch. 640px fits a
16:9 image at ~1100px wide, ~30 lines of code, one PDF page at readable scale.

### 4.2 Keyboard

`←` / `→` switch files only while the card has focus (`tabIndex=0`,
`focus-within`) and the event target is not a media control. Never a
document-level listener — the chat composer and the activity panel own those
keys otherwise. This is also why the card uses a plain `<img>` and not
`ImagePreview`: `ImagePreviewImpl.tsx:78` registers window-level arrow keys,
and seven cards would register seven.

### 4.3 Data path and resource identity

The payload settles identity: `root` and each file's `absolutePath` come from
the host at call time, so the card never consults `useEffectiveProjectRoot`
(`stores/app.ts:1365` — the *current* folder / worktree, which is the wrong
answer for an old block after a project switch). Every read the card makes
carries **both** `root` and `absolutePath`; a bare path is never enough,
because a node path without its connection is ambiguous.

Per-slide loader (`use-previewer-file.ts`), keyed by `root + absolutePath`:

- `text` / `markdown` / `notebook`: `window.app.readProjectFile(root,
  absolutePath)` for the bytes. No `getGitDiffFile`, no tabs, no
  unsaved-buffer plumbing — the card is a viewer, not a second `FilePreview`.
- `image` / `video` / `audio` / `pdf`: a URL. Local root → `toMediaUrl` /
  `toLocalFileUrl` as today. Remote root → `remote-media://<connectionId>/<path>`
  (`lib/remote-media-url.ts`, which today downgrades an out-of-project node
  path to a local URL at `:80-84` and must instead keep the connection for
  zone paths). The element loads when mounted.
- `missing` / `unpreviewable`: nothing to load; render the state from the
  payload.

The loader does not branch on remote. In the main process, `readProjectFile`
and the media URL handler resolve `(root, path)` through `resolveSessionFile`
(`session-sync-zone.md` §4.2): a node-zone path maps by prefix to the desktop
mirror (present for anything the desktop produced, fetched once via
`artifact.get` otherwise), a project path goes through
`readRemoteProjectFile` (`remote-file-tree.ts:626`; today a node `too-large`
surfaces as an error, `:636-642, 685-694`, and must map to the
`unpreviewable` state instead of the generic error).

Errors are structured, not inferred: the read / URL path returns
`{ kind: 'missing' | 'forbidden' | 'too_large' | 'io' }` and the loader shows
the matching state. An element `onerror` after a successful stat means
"undecodable" and is shown as such; a missing file is a `missing` result,
not an `onerror` guess.

Loading policy for v1: **the current slide only**, no adjacent prefetch, no
retained cache — a slide that scrolls out of view releases its bytes. The
retained-set / LRU idea from earlier drafts is dropped: entry counts cannot
bound bytes (one notebook can be 50 MiB, `file-read-limits.ts:12`), and the
phone's host-image cache is a separate module-level map the card cannot
govern anyway. Revisit after measuring.

### 4.4 States (each one is a story)

| State | Card shows |
|---|---|
| loading | header chrome from the payload, stage skeleton, note present |
| ready | as §4.1 |
| `missing` | stage: `FileX2` icon + "File not found" + retry. Retry re-runs the builder's stat path for that file (a new `statSessionFile(root, path)` IPC), **not** `readProjectFile` — which returns a media kind before stat'ing (`index.ts:3248-3252`) and cannot tell a file appeared |
| `forbidden` / `too_large` / decode error | stage: icon + reason ("Cannot be displayed", "Too large to preview", …) + retry where a retry can change the answer |
| `unpreviewable` | stage: icon + name + size + reason. No button — the header chip is the way to the panel, same as everywhere else |
| single file | no arrows / dots / counter |
| narrow (<480px pane) | arrows always visible (no hover on touch pads) |

## 5. Desktop — fullscreen

`PreviewerFullscreen` reuses `FullscreenGlassDialog`
(`components/chat/FullscreenGlassDialog.tsx`), the same shell `MarkdownTable`
and the mermaid viewer use, so it inherits the 90vw/90vh glass panel, the
dimmed backdrop and `esc`. This is where every real interaction lives.

Same chrome as the card — no rules between the bands, the stage is the only
surface, everything else sits on the glass:

```
  docs/design/architecture.png                1 / 7    [×]
        ╭─ stage (rounded, bg-muted/30) ────────────╮
  (‹)   │        rendered file, large               │   (›)
        ╰───────────────────────────────────────────╯
                 note text, 14px foreground, centered
                        ● ─ ● ● ● ● ●
```

- The header path is the same root-aware chip: click → `openFileTab`
  **and** close the dialog. This is the only bridge from fullscreen to the
  panel (decision above — no separate button).
- The arrows sit in fixed-width gutters beside the stage, never over it — a
  zoomed image or a line of code is not something to read through a button.
- Footer: the note, then the same clickable dots as the card. No per-file
  strip — the header chip already names the current file, and the dots plus
  `← →` cover jumping.
- Stage renderers are the panel's full ones: `ImagePreview` (zoom / pan /
  pinch via `react-zoom-pan-pinch`, `ImagePreviewImpl.tsx:84` — the same
  component `ImageViewer` mounts at `image-shared.tsx:387`), `PdfPreview`
  in its default mode, `FileWithDiffView` / `CopyableMarkdown` /
  `NotebookPreview` with selection, context menu and copy enabled, media with
  full controls and download.
- `ImagePreview` registers window-level arrow keys; the dialog's own
  `←` / `→` (as in `image-shared.tsx:354`) must be the single owner, so
  `ImagePreview` is mounted with its key handling disabled or the dialog
  handles keys and `ImagePreview` does not — pick one when implementing,
  never both.
- `FullscreenGlassDialog` prevents auto-focus (`FullscreenGlassDialog.tsx:23`);
  the previewer focuses its stage on open and restores focus to the card's
  fullscreen button on close, otherwise `←` / `→` go nowhere.
- Index is shared with the card, so closing fullscreen leaves the card on the
  file you were looking at. While fullscreen is open the card's inline
  `<video>` / `<audio>` are paused.

## 6. Phone

### 6.1 Constraints that shape it

The chat WebView has no origin and cannot read host files; every byte comes
through the RN bridge (`packages/chat-view/src/bridge.ts`,
`apps/mobile/src/native-actions.ts`). The payload gives the card `kind`,
`absolutePath`, `size` and `root` up front, so it knows which bridge path to
take without a round trip:

| Kind | Phone path today | Card uses |
|---|---|---|
| image | `PortableHostImage` → `loadImage` RN action → desktop `read_desktop_file` (data URI; relay inlines ≤512 KB, larger shows the existing Load / confirm state) | the component, with a new `onOpen` prop (§6.2) |
| video | `PortableHostVideo` → `loadVideoPoster` → desktop `read_video_poster` (`apps/mobile/src/video-posters.ts:61`) | the component (poster + play badge; no inline playback on the phone), with `onOpen` |
| text / markdown, `isInlinePreviewCandidate(name, size)` | `loadTextFile` native action (`apps/mobile/src/text-files.ts`: one `read_desktop_file` with `preferInline` + `statOnly`, so a small text file comes back in-band and anything else answers `tooLarge`) | rendered by `PortableMarkdown` — Markdown as is, source fenced with a language tag so the code plugin highlights it — scrolling inside the card with links, copy buttons and selection inert |
| pdf / audio / notebook / large text / unpreviewable | `previewFile` transfer → native viewer / share | **chip stage** (icon, name, size, "Tap to open"); no inline render |
| missing | — | error chip, no tap target |

So the phone card is a real preview for image / small text, a poster for video,
and a handoff for the rest. The asymmetry with desktop is accepted: it matches
how every other file already behaves on the phone, and closing it would mean
streaming PDF bytes into a WebView with no origin. Video does not play inline
on the phone because the bytes are not there — `mobile-markdown-media.md`
explains why relay media are download-then-play; the poster's tap opens the
normal preview, which downloads and plays with `expo-video`.

Identity and caches. `PortableHostImage` / `PortableHostVideo` keep
module-level maps keyed by bare path; the previewer's text cache
(`PortableFilesPreviewer.tsx`) is keyed the same way and bounded to 4M
characters, oldest-first. Re-keying all three by `root + path` waits for
phase 3, when two roots can first hold the same path. On the desktop side
the phone's file commands all land in `authorizeRemoteFile`
(`agent/agent-service.ts:1995`) with `skipRootCheck`, so the card's
`absolutePath` is served as-is today — which is also why phase 2 needed no
`root` on the wire; phase 3 adds it so `resolveSessionFile` can serve a
node-zone file from the mirror. The phone never talks to the node; a node
project file still crosses two hops (phone → desktop → node) through the
same `readRemoteProjectFile` the panel uses.

### 6.2 Card (`packages/chat-view/src/PortableFilesPreviewer.tsx`)

Mounted from `PortableToolRow` (§2.3) with the parsed payload. Height
**400px**. Header: `name` + `n / N`; no fullscreen button — the whole stage is
the tap target. **No arrows**: the phone moves between files by swipe alone,
with the dots as the only visible position indicator.

- Only the current slide is in the DOM (no translated track): the WebView
  already fights for layout during streaming, and a 7-slide track of
  `PortableHostImage`s would request seven `loadImage`s.
- Horizontal swipe switches files: pointer events, 40px threshold, 8px tap
  slop with the axis locked on the first move past it (`previewer-swipe.ts`,
  pure and unit-tested), `touch-action: pan-y` on the stage so vertical
  scrolling stays with the chat list. A release that ended a swipe — or a
  `pointercancel`, which is the browser taking a vertical scroll —
  **suppresses the click** the browser synthesises next, before anything
  inside the stage sees it. Text stages scroll vertically inside the card.
- `PortableHostImage` (opens `previewImage` once the bytes are in, else
  `previewFile`) and `PortableHostVideo` (→ `previewFile`) keep their own
  click: the stage's capture-phase handler lets any `<button>` inside run
  untouched and only claims the tap elsewhere, so a loaded image opens the
  viewer over the bytes already on the phone with no second transfer, and a
  relay Load button still loads. No `onOpen` prop was needed.
- Footer: note (2-line clamp) + dots.
- **Tap → `requestNative('previewFile', { root, path: absolutePath })`** for
  the current row. That is the existing `FilePreviewModal`
  (`apps/mobile/src/ui/file-preview.tsx:67`, owned by
  `navigation/mobile-overlays.tsx:82` / `use-file-preview.ts:170`): zoomable
  image, `expo-video`, text, or the transfer flow with confirm / progress /
  share. The previewer adds nothing on the RN side beyond `loadTextFile` and
  the `root` field on the existing file commands — no new modal, no carousel
  inside the viewer, no index round-trip, no gesture arbitration with
  `image-gesture.ts`.

## 7. Stories and tests

Storybook (root `CLAUDE.md` requires them in the same change):

- Desktop `files-previewer/*.stories.tsx`: one story per renderer kind, the
  shared loading / missing+retry / forbidden / too-large / decode-error /
  unpreviewable / single-file / narrow / long-note states, and an interactive
  story walking arrows → fullscreen → header chip. Stories mount
  `FilesPreviewer` with a literal payload; `apps/desktop/.storybook/mock-ipc.ts:10`
  returns `undefined` for anything not registered, so each story registers
  `readProjectFile` / `statSessionFile` answers explicitly; media come from
  static fixtures.
- `packages/chat-view`: `PortableFilesPreviewer.stories.tsx` (collected by
  `.storybook/main.ts:20`) — swipe, chip stage for a PDF, poster stage for a
  video, text stage for a `.md`, a >512 KiB image in its Load state, missing
  row, and the streaming compact row.
- `apps/mobile`: nothing new to show — the tap lands in the runtime
  `FilePreviewModal`; `apps/mobile/src/preview/FilePreviewGallery.tsx` is the
  fixture gallery for that modal and needs no new entry.

Tests (follow the per-workspace conventions, or they silently do not run):

- `apps/desktop/src/main/generative-ui/native-widget-payload.test.ts` —
  builder: relative path inside `cwd` (a worktree after `setCwd`, not
  `projectPath`), relative path escaping `cwd` rejected, absolute path under
  a readable root allowed, absolute path outside → `unpreviewable`, missing →
  `missing`, NUL-sniffed `.txt` → `unpreviewable`, too-large, 0 / 51 files
  and oversized notes → `isError`, no content in payload; remote context:
  `root` is the `remote:` key, zone path with no mirror calls `artifact.stat`
  and is not `missing`, project path uses `workspace.listDir`, absolute
  outside both → `unpreviewable`, node without `syncZone` → `missing`.
- `packages/shared/src/generative-ui/native-widgets.test.ts` — parser
  accepts `files`, rejects empty `files`, rejects a payload carrying both
  `files` and `images`.
- `packages/chat-view/src/presenters/tool-display.test.ts` (the symbol
  lives at `tool-display.ts:81`; shared must not depend on chat-view) —
  `isHiddenToolBlock` stays `false` for a `files` payload and `true` for a
  gallery; `collectGeneratedImages` ignores `files`.
- `packages/chat-view/vitest.config.ts:7` collects only `src/**/*.test.ts`
  (SSR, no jsdom): `PortableToolRow` sends `files-previewer` to the ordinary
  row in phase 1 and to the card in phase 2, galleries to
  `PortableNativeGallery`, and an unknown `nativeType` to the ordinary row;
  the Codex path through `PortableClaudeTool` reaches the same dispatch;
  payload survives `remote-content` trimming.
- ACP / Codex / OpenCode: a 16 KiB payload passes `acp-event-map` and
  `tool-result-map` intact; Codex `codexMcpResultText` yields the same parse.
- `apps/desktop/src/renderer/src/components/chat/files-previewer/*.test.tsx`
  — first-line `@vitest-environment jsdom` docblock (`apps/desktop/CLAUDE.md`
  testing section): `ToolBlockPresenter` dispatches to the block for a settled
  result, to the compact row while streaming and for `allowExpand=false`;
  only the current slide is read; keyboard scoped to focus and not media
  controls; stage click opens fullscreen but a click on the media control bar
  does not; links / copy buttons inside a Markdown stage are inert;
  fullscreen index round-trip and focus restore; header chip calls
  `openFileTab` with `{ root, path }`; two blocks with the same path and
  different roots read different files; structured `missing` / `forbidden`
  results map to their states and retry calls `statSessionFile`.
- `apps/mobile`: `native-actions.test.ts` gains `loadTextFile` (size cap,
  binary sniff, error shape) and `root` on `previewFile` / `read_desktop_file`
  / `read_video_poster`; `PortableFilesPreviewer` swipe suppresses tap.

i18n: every new label (kind badges, `n / N`, loading / missing / reasons /
retry, "Tap to open", a11y labels) goes into `packages/shared/src/i18n/en.ts`
+ `zh.ts` (desktop + chat-view); `apps/mobile/src/i18n/messages.ts` only if
`loadTextFile` surfaces a user-facing error.

Build: every change under `packages/chat-view` needs `bun run build:chat-view`
before the phone shows it; the generated HTML is not committed.

## 8. Phases

1. **Template + desktop card + fullscreen** — catalog entry and tool
   description (all three copies + drift test), payload builder with
   `resolveSessionContext` (live `cwd`), limits, `parseNativeWidgetResult`
   extension, phone `nativeType` guard, ACP / Codex result-cap exemptions,
   shared extension sets (all four consumers rewired), `PdfPreview`
   `variant="stage"`, root-aware `openFileTab`, `statSessionFile` IPC,
   structured read errors, `FilesPreviewer` with all §4.4 states,
   `PreviewerFullscreen`, `ToolBlockPresenter` dispatch, stories, tests.
   Fullscreen ships with the card because the card's stage click and `⤢`
   button have no other meaning. A remote session calling the template in
   this phase gets an explicit `isError` ("not available on remote nodes
   yet") from the builder — not an accidental fallback: `widget_show` with a
   saved template works on remote sessions today because the template store
   falls back to the user scope (`template-store.ts:44-48, 78-84`), so
   "missing projectPath" does not naturally produce an error.
2. **Phone card** — implemented: `PortableFilesPreviewer`, `PortableToolRow`
   dispatch, `loadTextFile` native action (`text-files.ts`, port, handler),
   swipe with tap suppression, chip stages, tap → `previewFile`, stories
   (`Chat/SuperOne/Files previewer`), DOM tests under the desktop jsdom suite
   (`portable-files-previewer.test.tsx`). Deferred to phase 3 with the reason
   for them: `root` on the file commands and cache re-keying by root. Needs
   `build:chat-view`; no native module, no dev-client rebuild.
3. **Remote sessions** — implemented.
   `environment/files-previewer-context.ts` resolves the session for a Host
   Action call (root = `remote:<connectionId>:<hostProjectPath>`),
   `files-previewer-remote.ts` stats each entry — a zone path through the
   lazy mirror, a project path through `workspace.listDir` on its parent — and
   `buildFilesPreviewerPayload` takes a `PreviewerBuildContext` so the local
   and remote paths share one classifier. On the desktop the card resolves
   `absolutePath` through `resolveSessionFile` (media as `remote-media://`);
   on the phone `root` rides on `loadImage` / `loadVideoPoster` /
   `loadTextFile` / `previewFile`, and `PortableHostImage`,
   `PortableHostVideo` and the previewer's text cache key on `root + path`.

Each phase is a separate PR.

### Deviations from the design as written

- **A remote *project* file is classified from its extension, not sniffed.**
  §5.2 has the builder sniff the first bytes to separate text from binary;
  over RPC that is a second round trip per file for a distinction the
  extension already makes in every case the card renders. Zone files *are*
  sniffed — the mirror is local by then, so it costs nothing.
- **A path under neither the zone nor the project is `unpreviewable`
  (`outside_readable_roots`), not `missing`.** It exists as far as anyone
  knows; what is missing is permission to look, and the card should not claim
  the agent's file is gone.
- **`previewFile` always carries `root`**, local sessions included — one
  command shape rather than two. Same for the cache keys: a local file keys on
  `'' + path`, so nothing about the local path changed.
- **`buildFilesPreviewerPayload` became `async`.** A remote stat is a round
  trip; the local path still does no I/O beyond the `stat` it already did.

## 9. Out of scope / open

- **Line targeting.** A `line` field on `files[]` is the natural extension;
  scrolling `FileWithDiffView` to it in a 400px card is cheap. Not in v1.
- **Remote-node artifact ownership** is the sync zone's problem, not the
  previewer's. All three gaps this section used to list closed on
  2026-09-14 (`session-sync-zone.md` §9): `browser_download` honours a `dir`
  inside the session zone, a deferred transfer now wakes the agent when it
  lands, and recordings, device captures and downloads write into the zone.
  What the previewer still inherits: a file is `missing` between the block
  rendering and the transfer landing. (Zone media over 10 MiB previews since
  2026-09-14: the host returns the mirror's `local-file://` URL and the
  previewer streams it like a local file.)
- **A session whose `cwd` is a worktree outside its registered project root**
  previews against the registered root, not the worktree. `previewerContext`
  authorises by registered project path on purpose — widening it to the
  session's `cwd` would widen file authorisation for every consumer of that
  context, which is not a previewer-sized change. Files under the worktree
  that are not also under the registered root read as `missing`.
- **Adjacent prefetch and any retained cache** on either surface: measure
  first.
- **Carousel inside the phone viewer** (swipe between the block's files
  without going back to the chat). Explicitly not wanted for v1: it would
  need a new modal, an index round-trip through the bridge and gesture
  arbitration with the image zoom. Revisit only if users ask.
- **Diff view.** The panel's "Changes" tab is not part of the previewer; the
  header chip is the way to get there.
- **Sessions without SuperOne tools** cannot trigger the block. If that ever
  matters, a Markdown-table dispatcher can build the same payload client-side
  and feed the same renderer — the rendering layer does not change. See §10.

## 10. Why a native template and not a Markdown table

The first draft used a table whose header was
`superone-preview-file | superone-preview-note`. It was dropped after the
first review surfaced problems that all disappear with a tool call:

| Problem with the table | With `@native/files-previewer` |
|---|---|
| Streaming: hast yields a body row for `\| \`src/Foo\`` before the line is closed, so the block would re-classify and re-read on every token until the turn ended; the fix was a turn-level gate and an end-of-turn table → card jump | The result lands once, whole; while streaming there is a compact row, same as every widget |
| Path fidelity: Markdown mangles bare paths (`src/a*b*c.ts` → `src/abc.ts`, `<tag>` stripped) and sanitize cannot undo it; the contract had to mandate backticks and reject link/image cells | JSON field |
| Existence and kind: the renderer could only guess from the name and learn "missing" from a media `onerror`; `readProjectFile` does not stat media | The host stats every file before answering; `kind`, `size`, `missing` are data |
| Project identity: the block had to recover its origin `projectPath` through a React context | `root` and `absolutePath` are in the payload |
| Discovery: a magic header needs a paragraph in a system prompt | `widget_list_templates` and the tool description already advertise native templates |

The table's one real advantage — it works in a session with no SuperOne MCP —
was judged not worth the costs above, and remains reachable later as a thin
adapter over the same renderer.
