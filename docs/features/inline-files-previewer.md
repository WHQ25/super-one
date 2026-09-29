# Inline files previewer (`@native/files-previewer`)

A native chat block presents several files as a carousel with a plain-text note
per file. Desktop, phone, local sessions and remote-node sessions share the
host-built payload. File ownership and delivery belong to the
[session sync zone](../architecture/session-sync-zone.md); phone transfer and
viewer behavior belong to [files.md](../../apps/mobile/docs/agent-reference/files.md).

## 1. Product contract

Use `widget_show` for several artifacts the user should inspect together. The
inline card offers a preview; opening it enters the full viewer. The desktop
header file chip opens the activity panel. The phone opens its existing file
preview for the selected file, without adding a second carousel inside it.

A native tool result preserves paths as JSON, carries host-checked file identity,
and arrives as one complete block. A Markdown table would need escaping,
streaming-row gates and renderer-side path inference, so it is not the trigger.

## 2. Tool contract

### 2.1 Input and classification

```ts
widget_show({
  title: 'Changed files',
  template: '@native/files-previewer',
  data: { files: [
    { path: '/abs/path/diagram.png', note: 'Arrows show the request direction.' },
    { path: 'src/example.ts' },
  ] },
})
```

The builder accepts 1–50 entries and at most 500 characters per note. Paths are
absolute or relative to the session's live working directory. Notes are plain
text. These limits live in `packages/shared/src/generative-ui/native-widgets.ts`;
the builder does not enforce a separate 16 KiB payload limit.

`fileKindFromName` in `packages/shared/src/file-preview.ts` is the common
classification source. Kinds are image, PDF, video, audio, model, Markdown,
notebook and text, plus the host verdicts `missing` and `unpreviewable`.
[3D model preview](3d-model-preview.md) owns model formats and loading constraints.

### 2.2 Host-built payload and remote identity

`apps/desktop/src/main/generative-ui/files-previewer-payload.ts` builds
`{ kind: 'native', nativeType: 'files-previewer', title, root, files }`. Each file
carries the original `path`, resolved `absolutePath`, `name`, `kind`, optional
`size`, `reason` and `note`. Bytes are loaded by the viewer, never placed in this
payload.

Local resolution uses the session's current `cwd`, including a fork worktree,
not its original project identity. Relative paths must remain inside that root;
absolute paths must be within the host's readable roots. Realpath checks also
cover symlinks. Missing files retain their row and order. Text is sniffed for
binary content and checked against the read limit; models have their own cap.
Forbidden paths are `unpreviewable/outside_readable_roots` rather than missing.

Remote context comes from `environment/files-previewer-context.ts`, because a
node session has no local `SessionManager` entry. The payload root is
`remote:<connectionId>:<hostPath>`. `environment/files-previewer-remote.ts` handles:

- Node-zone paths: resolve any desktop mirror path back to its node identity,
  stat and mirror through the artifact RPCs, then classify and sniff locally.
- Project files: list the parent through `workspace.listDir` and classify by
  extension and size, without a second RPC to sniff the head bytes.
- Paths outside both roots: return `outside_readable_roots`.
- A session `cwd` outside its project: use an existing node project rooted at or
  above that directory if one exists. Never register a ghost project as a preview
  side effect. Without such a project, outside paths remain unpreviewable.

`statPreviewerFileForRoot` reuses this resolution for Retry. Root plus absolute
path is the resource identity: a bare `/srv/app/report.png` cannot identify a
file when multiple nodes contain that path.

### 2.3 In-place rendering

`parseNativeWidgetResult` requires a nonempty root and renderable file list, and
rejects previewer payloads carrying gallery images or videos. Previewers render
at their tool-call position; they are neither hidden nor collected into the
turn-end image/video gallery. Unknown or invalid payloads retain the ordinary
tool row. Streaming and denied calls also keep the normal row.

Desktop `ToolBlockPresenter` and phone `PortableToolRow` dispatch by `nativeType`.
The ACP result mappers and mobile event projection preserve native-widget
payloads rather than truncating them as generic tool text.

## 3. Renderers

| Kind | Desktop inline preview | Phone inline preview |
|---|---|---|
| Image | Contained image | `PortableHostImage` with existing load states |
| PDF | First page through `PdfPreview` stage mode | File chip |
| Video | Native playback controls | Poster; tap opens the native viewer |
| Audio | Native playback controls | File chip |
| Model | Model preview | File chip; full preview uses the mobile viewer |
| Markdown, small text | Read-only formatted/highlighted content | `loadTextFile` and `PortableMarkdown` |
| Notebook | `NotebookPreview` | File chip |
| Missing/unpreviewable | Reason and applicable retry | Error or file chip |

Inline text is read-only; editors with autosave are not used here.

## 4. Desktop card

### 4.1 Layout

`components/chat/files-previewer/` owns the card, stage, fullscreen and loader.
The card height is 480px in narrow panes and 640px from the `@lg` container
breakpoint. Keeping it fixed avoids moving the transcript when slides change.
Header, stage and note/navigation footer form one block. Single-file cards omit
the counter, arrows and dots. Fullscreen is available from the stage and header.
Media controls retain their playback interaction.

### 4.2 Keyboard and focus

Inline left/right navigation is scoped to the card's focus, avoiding the composer
and media controls. Fullscreen owns its own navigation and returns to the same
selected file on close. Keep nested viewer shortcuts from advancing two slides.

### 4.3 Loading and errors

`use-previewer-file.ts` reads only the current slide, using the payload's root
and absolute path rather than the active project selection. Text uses the host
file reader; media uses local or remote media URLs. A mirrored remote-zone file
can use its local media URL, avoiding project-file RPC size limits.

Retry re-stats the file through `statSessionFile`; a media URL alone cannot tell
whether a missing file appeared. Loading, missing, forbidden, too-large, binary
and decode failures have distinct presentation. A deferred remote transfer may
leave a file missing until delivery completes.

## 5. Desktop fullscreen

`PreviewerFullscreen` uses `FullscreenGlassDialog` and full file renderers.
Selection is shared with the inline card. The header file chip opens the
root-aware activity-panel file tab and closes the dialog. Media in the inline
card is paused while fullscreen is open. Fullscreen provides the viewer's zoom,
selection and media controls rather than putting editing controls in the card.

## 6. Phone

### 6.1 Identity and byte delivery

The WebView cannot read host files. `loadImage`, `loadVideoPoster`, `loadTextFile`
and `previewFile` carry the payload root and path through the RN bridge. The
phone reaches a node through its paired desktop; it does not open a node socket.
Image, video-poster and text caches distinguish roots. The text cache is bounded
to 4 Mi characters and evicts oldest entries. Failed/oversized text loading
falls back to a file chip.

### 6.2 Card interaction

`packages/chat-view/src/PortableFilesPreviewer.tsx` fixes the **stage** at 320px;
notes may grow beneath it. Only the current slide mounts. Swipes use
`previewer-swipe.ts`, with a 40px threshold and axis lock after 8px; vertical
scroll stays available through `touch-action: pan-y`. Swipes and pointer
cancellation suppress the synthesized click. Embedded load/view buttons keep
their own handlers. Other taps call the existing `previewFile` native action.

## 7. Verification and source map

- Host payload and local limits: `generative-ui/files-previewer-payload.ts` and
  `native-widget-payload.test.ts` in desktop main.
- Remote resolution: `environment/files-previewer-context.test.ts` and
  `files-previewer-remote.test.ts`.
- Parser and dispatch: `packages/shared/src/generative-ui/native-widgets.test.ts`
  and `packages/chat-view/src/presenters/tool-display.test.ts`.
- Desktop UI: tests and `FilesPreviewer.stories.tsx` beside the component.
- Phone UI: `packages/chat-view/src/portable-files-previewer.stories.tsx` and
  the desktop jsdom `portable-files-previewer.test.tsx`; native-action checks
  cover the RN handoff. Rebuild chat-view before checking generated mobile HTML.

Line targeting, adjacent prefetch and a carousel inside the phone's full viewer
are not part of the current contract. Diff editing stays in the activity panel.
