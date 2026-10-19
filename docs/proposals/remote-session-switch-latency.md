# Remote session-switch latency

Status: phases 0, 3a, 1, 4, 5, and 3b implemented · Updated: 2026-10-19
Plan: none yet — the direction is implemented; the step timings are in place (`[SessionRestore]` `stopMs` / `windowMs` / `acquireMs` / `cacheReadMs`, `[TranscriptWrite]`), but the switch baseline and the Verification runs are not recorded
Related: [mobile-transcript-window-sync.md](mobile-transcript-window-sync.md) (accepted; the window contract this work uses)

Scope: the phone, and a desktop controlling another environment (a desktop
or a CLI node). Both speak the same RPC protocol; they differ in which read
they use to open a session.

## Problem

Switching sessions on the phone still waits on a serial remote round trip
before the transcript cover drops. The window protocol already bounds what
crosses the wire (about 128 KB, at most 48 fragments, roughly three screens).
The wait is the path around that payload: four ordered network steps, a host
read that materializes far more than the window, and a synchronous cache
rewrite of the session being left.

A cache hit already paints local fragments and clears the cover before the
host answers (`ChatRuntime` `onCachedHydrate`). A first open, an evicted
window, or an empty window keeps the cover up until restore finishes. Every
switch, hit or miss, still stringifies the previous window on the JS thread
before the next request starts.

A controlling desktop does not use the window protocol. Every switch to a
remote session re-reads up to 200 whole messages through legacy
`session.load`, even when the renderer already holds them, and cannot page
past them.

Separately, a cold desktop session longer than 200 messages is served as if
it had only its newest 200. That is a correctness bug, not latency, and it is
fixed first (phase 0, shipped with the bounded desktop read, phase 3a).

## What a switch does today

`openSession` in `apps/mobile/src/navigation/mobile-app.tsx` sets
`sessionLoading`, then awaits `ChatRuntime.open`. The chat screen uses that
one flag both to cover the transcript and to disable the composer
(`loadingConversation`). `ChatRuntime.open` first calls `persistTranscript()`
for the session being left, then reads and parses the cached window blob,
then calls `restoreWindowSession`
(`packages/relay-client/src/restore-window.ts`), which does, in order:

1. `session.stop` — unsubscribe and release the previous session's lease.
   Shares `PhoneSessionFeed` with the later subscribe.
2. `project` resolve — cached after the first `project.list` for that
   environment.
3. In parallel: `session.transcriptWindow` and `environment.descriptor`.
4. `session.acquireControl` — a lease for later sends. It does not resume
   the harness.
5. `topic.subscribe` — events after the snapshot cursor.

The cover drops only after step 5. Events that arrive during the steps sit
in the existing restore buffer and are filtered onto the new session when
the buffer is released. `[SessionRestore]` `snapshotMs` covers steps 1–3;
`subscribeMs` covers steps 4–5. In window mode `historyMs` is 0.

The `signal.aborted` checks between steps also bound side effects: a
superseded switch never starts an acquire. Any overlap has to keep that
property explicitly.

On the host, `session.transcriptWindow`
(`packages/runtime/src/server/rpc-session-window.ts`) calls
`sessions.load({ full: true })` and only then cuts the tail.

| Host state | What `load` materializes | What the phone receives |
|---|---|---|
| Desktop session still in memory | The live snapshot, every message | The tail window |
| Desktop session not in memory | The newest 200 messages, each parsed from full `content_json` (`loadSessionMessagesPaginated` clamps the page at 200) | The tail of those 200. `total` is the page length, so a longer transcript looks finished |
| Remote-node session, cold | Every `message_json` row, then events after the checkpoint (`SessionReadModel.load`), cached in the read model's LRU | The tail window, after the desktop has forwarded the RPC |

The full message list is not only the window's source. `DesktopSessionReads.load`
derives state from it:

- `withTranscriptTodos` — the newest `TodoWrite`, at any depth.
- `pendingCodexAsyncQuestions` — unanswered async questions, at any depth.
- `sessionRestoreFacts` — `mcpAppContexts` from the history.

Under the 200 clamp these already miss anything older than the page.

`WindowViews` (`packages/runtime/src/stream/delivery/window-views.ts`)
records each holder's window with absolute message indices and
`total = messages.length`; live patches (`diffHeld`) diff against the full
live list by index. `selectTranscriptWindow` treats index 0 as the top of the
transcript. Its input is already the `WindowSource` interface
(`count`, `at`, `indexOf`), not an array.

`DesktopSessionReads.load` also awaits `prepare()` whenever state is
included. `prepare` waits for Shiki (`whenHighlighterReady`) and, for an
ACP session, loads the Grok sandbox. The desktop starts the highlighter at
launch (`initHighlighter`), so the wait matters only for the first open after
a desktop start. `session.subscribeDetail` is synchronous and does not wait;
today it relies on an earlier load having warmed the highlighter.

Live delivery (`deliverFrame` in
`packages/runtime/src/server/session-delivery.ts`) appends a
`transcript_window` patch per holder for every session the connection holds
a window of. Content events are withheld only when
`delivery.policy.surface === 'phone'`; a desktop connection keeps every event
and also gets the patches, so a routing desktop can show its own view while
relaying windows to its phones. `WindowViews.serve` treats a holder as one
client following one session: serving a holder's window on one session drops
that holder's windows on every other session. A connection holds at most 64
windows. A routing desktop forwards a phone's `session.transcriptWindow`
with `holder` set to the phone (`routed-phone-rpc.ts`); a request without
`holder` uses the empty holder.

After the cover drops, the phone requests `harness.systemInfo`,
`git.status`, `git.worktreeInfo`, and later `session.historyIndex` for the
tick rail. Those are not on the cover. `session.historyIndex` reads SQLite
outlines over the whole transcript, so the rail can point past what the
clamped window can page to.

The on-disk window is one blob: bodies, manifest, and coverage together
(`putWindow`). Coverage is what the next open sends as `have`, so a blob
that claims a body it does not contain forces a second full read. Live
`transcript_window` patches update memory only (`ChatRuntime.apply`). The
blob is rewritten synchronously when restore finishes, when a history page
lands, at the start of `open()`, and in `dispose()`. `putBlob` also
rewrites the cache index. Rewriting that blob on every streaming patch
would stringify up to 2 MB, and run `trimWindowState`, on the JS thread
many times a second.

### On a controlling desktop

The chat store (`switchSession` in
`apps/desktop/src/renderer/src/stores/chat-store/index.ts`) shows any
session state it already holds, then always awaits `hydrateRemoteSession`
(`apps/desktop/src/renderer/src/lib/remote-session-ops.ts`):

1. `session.get` for the session row.
2. Then `openRemoteSession` (`EnvironmentHost.openRemoteSession`): follow the
   session's topic, with a barrier `session.load({ limit: 200 })` read while
   its events are held.

What comes back is up to 200 whole messages, summarized behind
`remoteDetail` on a relay link and complete on LAN, through the legacy load
path, highlighter wait included. The renderer replaces its page with it and
keeps older messages it already held. There is no request for older
history, so the desktop never sees past the newest 200 of a remote session.

The lease is acquired lazily on the first send (`ensureSessionLease`), not
on open. Followers stay per session; a switch does not stop the previous
one. There is no disk cache. Expanding a summarized row already works
(`desktopDetailClient`, `remote_detail`).

Other remote `session.load` callers: the Codex realtime view (the `restore`
voice facts) and `loadStoredSession` (`full: true`, the whole transcript plus
`state.stored`). An open of the local environment (`local`) reads in process
and is not a remote switch.

## Decisions

| Question | Decision |
|---|---|
| Baseline | Record `[SessionRestore]` on relay and LAN, cache hit and miss, for a live desktop session, a cold desktop session, and a cold node session, from the phone and from a controlling desktop (`hydrateRemoteSession` timing), before phase 1. Add the step timings (stop, window, acquire, subscribe, blob parse, blob write) the metrics do not split today. Phases 1, 4, 5, and 3b are re-prioritized against it; 0 and 3a go first regardless. |
| When the transcript cover drops | When the new window has been applied to the document. Acquire and subscribe do not hold the cover. |
| When a send goes out | The composer stays enabled. A send issued before `session.acquireControl` resolves waits on that pending acquire, then goes out with its proof. If the acquire fails, the send fails as it would today. `controlledRpc` still throws `lease_required` when no acquire is pending. |
| Overlap | Acquire starts once the project ref is known and runs beside the window read. `session.stop` runs beside the window read. Subscribe starts only after stop has finished and the snapshot cursor is known. Stop and subscribe both own `PhoneSessionFeed.current`. |
| Same-session reopen | When the previous ref equals the new one (`restorePeer` after a resnapshot or recovery), keep today's order: stop, then acquire. A release without a proof and an acquire of the same resource must not race on the host. |
| Abandoned acquire | An acquire that resolves after its transition failed, was aborted, or was superseded releases its own grant with that grant's proof. It must never be left held, because held grants renew indefinitely. |
| Gap between snapshot and subscribe | Keep today's buffer. Release it after subscribe, then paint the caught-up patches. A subscribe or acquire failure after the early paint still fails the transition and leaves the session. |
| Unanchored open (desktop) | The host reads from the tail until the window budget is met, then stops. `total` is the real message count (`COUNT(*)` or the live snapshot length), not the number of rows parsed. |
| Anchored page (`before` / `after` / `around`) | Locate the anchor by `sort_order` (desktop already does this for `session.historyIndex`) and read a bounded neighborhood. Do not load the transcript and slice afterwards. |
| Window source | The bounded read feeds `WindowViews` a `WindowSource` whose `count` is the real total and whose `at(i)` takes absolute indices over the rows read. Never a sliced array: indices, `older`, `total`, and live patches stay absolute. |
| Transcript-derived state | A bounded read does not shrink the state. Todos, pending async questions, and MCP App contexts come from their own bounded queries (newest `TodoWrite` block; unanswered async question rows; context sources), not from the window rows. This also removes the clamp's current loss. |
| Cursor atomicity | Tail, anchor, and state queries stay inside the synchronous section of `load`, after `prepare`, so rows, state, and cursor still describe one version. |
| Node host | `SessionReadModel`'s cached session stays complete. A bounded read is a separate path that does not enter the LRU and never feeds checkpoint persistence. It applies only when the checkpoint is current (no durable events after it, which is the state after every finished turn), so nothing is reduced over partial rows. A session with later events, from a turn that did not finish, loads complete. Whether it is worth keeping is decided from the baseline: the read model is cold only once per eviction. A routed phone forwards `session.transcriptWindow`; the source host does the read. |
| Highlighter | The window path keeps waiting on Shiki. The saving is limited to the first open after a desktop start, and `session.subscribeDetail` depends on that warm-up. |
| Cache shape | Remains one snapshot blob. Coverage and bodies are written together. |
| When the blob is written | Mark the window dirty when it changes. Writes go through one pending-write map keyed by session, latest wins, drained when the JS thread is idle after the cover drops. Enqueue at the quiescent points: restore finished, a history page finished, streaming stopped, the session left (`open()` and `dispose()`), and the app backgrounded. |
| Switch versus write | Leaving a session captures its cacheable window and enqueues it; the write itself is deferred and the next `open` starts immediately. A fast A → B → A may read A's older blob or miss; the host fills the tail. A later enqueue for the same key replaces an earlier one, so no generation check is needed. |
| Streaming patches | Do not rewrite the blob per patch, and do not rewrite it on a short interval during a turn. A switch in the middle of a turn enqueues one write and moves on. The host fills any tail the write missed. |
| Desktop open | A controlling desktop opens a remote session with `session.transcriptWindow`, as the phone does. `session.get` runs beside the window read. The follow barrier is the window's cursor. The lease stays lazy, on first send. |
| Desktop window state | `TranscriptWindowSync` moves from `apps/mobile` to `packages/shared/src/transcript-window/` and both clients use it. The desktop main process holds one window per remote session, next to its follower, and applies its holder's patches to it. The renderer keeps reducing the session's content events, which the desktop still receives; an open, a resync, or a page replaces its messages with the window's rows, and omitted bodies render as summarized rows through the existing detail client. |
| Desktop reopen | Main keeps each remote session's window in memory and sends its coverage as `have`, so a switch back costs the changed fragments, not 200 messages. Held windows are bounded like a host connection's (64, least recently opened dropped) and dropped when the session closes or the connection is disconnected. A held range joins a re-read tail only when adjacent; across a gap the tail replaces it. No disk cache on the desktop. |
| Desktop budget | The desktop passes its own viewport and budget; the server's budget limits stay the ceiling. Older and newer history page with `before` / `after`, which also lifts the 200-message limit. |
| Desktop holders | One holder per remote session (`desktop:<sessionId>`), shared by every pane and window showing it, distinct from routed phone ids. A single desktop holder would not work: `serve` drops a holder's windows on other sessions, and the desktop shows several sessions at once. Paging extends the shared window, so panes on one session see the same loaded range. A holder evicted by the 64-window cap is detected and that session resyncs. |
| Withholding | Content events are withheld per session reader, not per surface: a connection withholds a session's content events when every reader of that session on it takes patches. A routing desktop that shows a session itself keeps its events. |
| Legacy `session.load` | Stays for full-transcript reads (`loadStoredSession`), the realtime timeline refresh, and hosts that do not serve the window method (detected as the phone detects them). |

## Non-goals

- Prefetching windows for rows visible in the drawer. That multiplies host
  reads, and it waits until the tail read exists.
- Moving `harness.systemInfo`, git status, worktree info, or
  `session.historyIndex` onto the cover.
- Changing the fragment budget, detail-on-expand, or thumbnail rules.
- Skipping the highlighter wait on the window path.
- A disk cache of remote windows on the desktop.
- Local sessions on the desktop; they read in process.
- An event log as the cache format. The next open sends coverage, not a
  replay cursor.
- Blocking the switch on a durable write. The host remains authoritative.

## Phases

Phases 0 and 3a ship together and go first: phase 0 is a correctness fix,
and without 3a it would make cold opens of long sessions parse every row.
Every other phase is independently shippable; the default order after them
is 1, 4, 5, 3b. Phase 5 needs phases 0 and 3a for cold desktop sources; it
does not need 1 or 4.

- **Phase 0 — Honest cold desktop history.** Remove the 200-row clamp from the
   window path's view of a cold desktop session: real `total`, `older`
   that pages past 200, and transcript-derived state (todos, async
   questions, MCP App contexts) computed over the whole transcript through
   the bounded state queries. Ships with 3a.
- **Phase 3a — Bounded desktop read.** Tail read for an open with no
   anchor, anchor reads by `sort_order`, an absolute-index `WindowSource`,
   separate bounded state queries. For a session already in memory, pass a
   source over the live snapshot with its real count; do not require the
   window cutter to walk every message. Ships with 0.
- **Phase 1 — Client critical path.** Overlap stop and acquire with the window read,
   except for a same-session reopen. Apply the window and drop the
   transcript cover when it returns. Sends wait on the pending acquire.
   Release an abandoned acquire's grant. Subscribe after stop, then release
   the buffer. Update the `restoreWindowSession` order test and add tests
   for the abandoned acquire and the same-session order. Failure after the
   early paint still runs the existing failed-transition cleanup.
- **Phase 4 — Deferred cache write.** Dirty flag, latest-wins pending-write map,
   idle drain after the cover drops, enqueue at the points above including
   background. The single-blob invariant stays.
- **Phase 3b — Bounded node read.** The non-caching bounded path above, for
   a current checkpoint only. Keep it only if the baseline shows cold node
   reads on the switch path.
- **Phase 5 — Desktop controller on windows.** Move `TranscriptWindowSync`
   to shared. Open remote sessions with `session.transcriptWindow`, with
   `session.get` in parallel and the window cursor as the follow barrier.
   Per-session holders, windows held in main with `have` on reopen, `before` /
   `after` paging, eviction resync, and the per-reader withholding rule.
   Fall back to `session.load` on hosts without the method. Stories for the
   summarized, paging, and resync states.

## Risks

- Early paint then a failed subscribe shows a transcript that immediately
  closes. The failure path has to be the same one a failed `open()` uses
  today, including a switch that was superseded (`restoreGeneration`).
- An acquire left running after its transition ends keeps a renewed grant
  on a session the phone no longer shows, and the desktop treats that
  session as phone-controlled. Phase 1's abandoned-acquire release is
  required, not optional.
- A send queued behind a slow acquire looks like a slow send. If the
  acquire fails, the send reports the failure instead of silently dropping.
- A bounded read that derives state from window rows drops older todos,
  async questions, and MCP App contexts without an error. Phase 3a tests
  each with the source message outside the window.
- A partial node session in the read model's cache could feed checkpoint
  persistence and delete rows outside the tail. Phase 3b never caches it.
- Reducing events after a checkpoint over only the rows a window read would
  miss reducers that find their target by tool or request id. Phase 3b
  therefore reads by index only when no such events exist.
- A cold desktop transcript can now page past the newest 200 rows that
  `messages()` returns, so expanding a summarized row reads that row by id
  (`detailMessage`), not from the page.
- Until phase 0 lands, the phone history for a cold desktop session longer
  than 200 messages is incomplete, and the tick rail can point past it.
- `trimWindowState` stringifies fragment bodies to measure them. A write
  on every token would stall the open session. Phase 4 does not do that.
- Changing withholding from per surface to per reader touches every routed
  phone. A rule that withholds while the routing desktop still shows the
  session leaves the desktop's own view without content.
- A desktop that shared one holder across sessions would silently stop
  patching every session but the last opened. Phase 5 tests two panes on
  two sessions of one connection, and two panes on one session.
- On LAN the desktop gets whole messages today. Under a window, long
  messages arrive summarized until expanded. The desktop budget has to keep
  ordinary turns whole.

## Verification

- Baseline numbers recorded in the plan before phase 1, and the same runs
  after each phase.
- Phase 0: a cold desktop session with more than 200 messages reports its
  real `total`, pages to the first message, and restores a `TodoWrite`, an
  unanswered async question, and an MCP App context older than 200.
- Phase 1, relay and LAN, cache miss: the cover is gone before
  `subscribeMs` finishes. `snapshotMs` tracks one window round trip plus
  the overlapping stop, not stop + window + acquire + subscribe in series.
  A send typed before the lease goes out once the lease arrives.
- Phase 1, rapid A/B/C switches, including one session that is streaming:
  no missing or duplicated tail after subscribe, a superseded switch does
  not paint over the winner, and only the winner's lease is held afterwards.
- Phase 1, a resnapshot recovery on the open session: the reopen keeps
  stop then acquire, and the first send after it is not `lease_stale`.
- Phase 4: a cache hit no longer waits on `JSON.stringify` of the previous
  window before its own read starts. Reopen after a write: `reusedFragments`
  covers the saved bodies. Backgrounding with a dirty window writes it.
- Phase 3a: host timing of `session.transcriptWindow` for a cold session
  with a multi-megabyte tail, before and after. Parsed rows stay within the
  window budget plus the one message that crossed it. Live patches after a
  bounded open carry the same indices and `total` as after a full one.
- Legacy `session.load` and the window path both still highlight; a detail
  expanded right after a desktop start is highlighted.
- Phase 5, desktop controlling a desktop and a node, LAN and relay: a
  switch back to a held session sends only changed fragments
  (`reusedFragments`); a session longer than 200 messages pages to its
  first message; two panes on two sessions both keep updating while one
  streams; two panes on one session render the same window; a routed
  phone on the same connection keeps receiving its window; an older host
  still opens through `session.load`.
