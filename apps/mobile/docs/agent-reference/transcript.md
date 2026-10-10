# Mobile transcript and attachments

Paths below are relative to apps/mobile unless repository-qualified.

## Runtimes

| Runtime | Owns | Does not own |
|---------|------|----------------|
| **RN shell** | Pairing, nav, native `TextInput`, sheets, MMKV, chat-core reduce, host batching (≤1/33 ms) | Transcript paint |
| **Chat WebView** (`@superone/chat-view`) | DOM paint of reduction patches, scroll, expand | Re-reducing `AgentEvent`s |
| **Terminal WebView** | xterm frames | Event ACK / seq |

Never nest the chat WebView in an RN `ScrollView`. Input is native, except the
document's bottom dock (`BottomDock`): mod panes, a command's output and the
pending AskUserQuestion form, pinned above the composer so a Claude mod can wrap
them (`ModCommandOutputSite`, `ModQuestionSite`). Their data rides the
projection (`pendingQuestion`, `slashCommandOutput`); answers go back through
the `answerQuestion` / `dismissQuestion` / `dismissSlashOutput` native actions.
While a dock field holds the keyboard (`documentInputFocus`), iOS turns off
`MobileKeyboardFrame`'s avoidance: WKWebView already insets its visible area by
the keyboard, and shrinking the WebView too left it zero points tall. The
composer's action bar stays collapsed then, since its own keyboard check cannot
tell whose field raised it. Fields there are under 16px, so the document's
viewport sets `maximum-scale=1` to stop WebKit zooming onto them.
`Loading…` is only for switching to an existing session: the
previous transcript must not stay on screen while restore runs. Keep the
WebView mounted at opacity 0 under that cover *and* under the new-session
landing (`opaque={false}`, themed background, pre-paint script) so the first
send and a session switch both reveal an already-themed document. Unmounting
it remounts onto WKWebView's white default and flashes in dark mode. Leaving
the landing injects `reset` so a previous transcript cannot leak into the
next first send. The first send itself has no "Starting session…" / loading
copy: the composer empties, and the user bubble and title are painted, before
the draft flush and the `create_session` round trip (`ChatRuntime.stageTurn`),
and a `pendingTurn` line ("Creating session…" → "Sending…") sits under the
bubble inside the WebView until the assistant's `message_start` lands. Every
live send paints its own bubble the same way, under the `clientMessageId` the
host echoes back. Create failures still surface on the status line from the
host `create_session` error, and hand the cleared draft back to the composer.
A picked picture is re-encoded on the phone before anything else sees it
(`src/chat-image-encoding.ts` decides, `expo-image-manipulator` encodes): the
library returns assets as stored — HEIC on every iPhone — and the host's Read
tool and the model accept only JPEG/PNG/GIF/WebP, so HEIC/TIFF/AVIF become
JPEG, anything over 2048 px on its longest edge is scaled down, a PNG stays PNG,
a GIF is never touched, and the bytes are sniffed afterwards rather than
trusting the picker's mime type. The user bubble shows each attachment as the
desktop's inline chip (`AttachmentChipPresenter`, see the user bubble in
`docs/architecture/chat-core.md`): a picture opens the native viewer, a PDF the
file preview page (`previewAttachment`); the optimistic bubble carries the same `image` /
`document` blocks the host builds, because the host's echo is deduplicated
away and a reopened session must look the same. A transcript loaded from the
host carries only a 256 px thumbnail per picture (`ImageAttachment.preview`,
cut by `apps/desktop/src/main/remote/attachment-thumbnail.ts` on every
mobile projection: restore, history pages, the live `user_message_appended`);
tapping the chip fetches the original through the `loadAttachment` native
action → `get_attachment` RPC, memoised per session in `ChatRuntime`.
A picture attached to a send crosses the wire exactly twice (draft flush and
`send_message`): the host strips attachment bytes from `list_drafts`,
`save_draft` replies and `draft_changed`, `prepareSend` opens the draft with
`omitContent`, and the `user_message_appended` echo goes back to its sender
without `base64` (the phone already painted it — see
`apps/desktop/src/main/remote/attachment-echo.ts`). Every frame is still
AES-GCM'd; `src/native-crypto.ts` swaps the relay-client's pure-JS
`@noble/ciphers` (~1 MB/s on Hermes, synchronous) for OpenSSL via
`react-native-quick-crypto` at app start, so do not expect a JS profile to
show the cipher any more — if a send is slow again, count the crossings first.
The conversation tick rail also lives in the chat WebView (`ChatScrollIndicator`),
where it can measure and navigate the transcript without round-tripping through RN.
The host disables its native vertical scrollbar. `ChatScrollbar` shows a document
overlay during manual scrolling (including momentum), hides it after inactivity,
and clears it before automatic following or navigation.
Its turn outline and tick curve are shared with desktop. Touch scrubbing previews
questions and replies, then jumps on release; compact ticks expand/collapse history.
Navigation mounts a bounded neighborhood around the target, and paging moves in
both directions while retaining a visible anchor and the 40-message DOM ceiling.

## Progressive loading

Opening a session paints the newest turns first: `session.load` returns the newest eight projected messages,
reducer state, the active turn and an epoch/version cursor atomically, and `loadEarlier` fetches one page at a time. Thinking,
tool inputs/results, commands and diffs arrive as opaque detail references and are
fetched through `session.subscribeDetail` only when opened; collapsing unsubscribes.
Streaming reasoning starts collapsed (`DeferredReasoning` in `@superone/chat-view`)
and a manual expansion stays open when it finishes. The tick rail covers the full
timeline from `session.historyIndex`; a tick outside the loaded rows jumps via
`session.load` with an `anchorId` (`ChatRuntime.loadHistoryWindow`).
`ChatRuntime.restoreMetrics` (logged as `[SessionRestore]`) times request phases and
bytes; it does not measure WebView startup or first paint.

Live paints cross the bridge as changed rows — `messagePatches`, plus `messageOrder`
only when rows are inserted, removed or reordered (`src/transcript-projection.ts`) —
through the acknowledged `TranscriptDelivery` (see transport.md). Never inject the
full transcript per tick: WKWebView can silently drop a large, unacknowledged
`injectJavaScript`, which left live turns stuck on Reasoning with the following
text never painted.
