# Mobile progressive session loading

The mobile transcript now opens with a bounded summary projection. Persisted host
messages and the desktop transcript remain complete.

## Initial view

A `subscribe_session` request with `progressive: true` returns the subscription,
the latest eight messages, the history cursor, and the current session snapshot in
one response. Older hosts retain the three-request fallback. Opening a session no
longer walks up to 50 history pages. `loadEarlier` fetches one page, deduplicates
against the current live messages, and retains the visible scroll anchor.

The database query selects only the requested rows with LIMIT/OFFSET. Reading the
harness uses its dedicated metadata query, rather than loading every message.
Model catalog loading no longer blocks transcript visibility. The unused project
resource request was removed from that path.

## Hidden detail

Thinking blocks, Codex reasoning items, ordinary tool inputs/results, commands,
file diffs, and collaboration activity carry opaque detail references in the
summary view. Inline widgets/media and user decision prompts retain the data
needed to render their visible UI. File-edit headers keep the `+N -M` line
delta in the summary so the collapsed row matches the desktop. Tool
diff/highlight generation still runs after expansion.

Each expansion creates a device-scoped subscription. Its response establishes a
revision-zero snapshot; newer packets carry a revision, prefix offset, and suffix.
The client buffers packets that precede the response and ignores older revisions.
Large suffixes are split into 64,000-character packets. Prefix replacement handles
both additive reasoning and growing JSON tool results without retransmitting the
whole previous value.

Collapsing or unmounting cancels the subscription. Session changes, leave, and
disconnect clear host interests. Completed detail text uses an LRU cache bounded
to one million UTF-16 code units; opening a cached completed block does not fetch
it again. A failed request exposes Retry. Streaming reasoning starts collapsed;
manual expansion stays open when the reasoning finishes.

## Mobile processing

The RN/WebView bridge sends changed message rows. It sends message ordering only
when rows are inserted, removed, or reordered. The eight-row initial window
and 40-row DOM ceiling still apply. Delayed events for another session are ignored.

`ChatRuntime.restoreMetrics` and the `[SessionRestore]` mobile log record request
phase times plus UTF-8 history/snapshot bytes. In the one-response path the host
work is included in `subscribeMs`; these values do not measure native WebView
startup or time to the first painted frame.

## Verification and remaining measurement

Targeted tests cover bounded restore, old-host fallback, bootstrap-to-runtime
hydration, page/live merging, per-device isolation, subscription cancellation,
replacement/chunk reconstruction, and Codex completion metadata. Browser tests
exercise the production chat document, manual reasoning expansion, response/event
races, history requests, completed-tool cache reuse, and changed-row patches.
Stories are available under **Chat/Mobile progressive loading** and
**Chat/Mobile history pagination**.

A synthetic message containing 300k reasoning characters, 500k input characters,
and 500k result characters projects from over 1.3 MB to under 1 KB. This is a
payload assertion, not a measured speedup on a phone or network.

Real-device LAN/relay measurements, p95 first-paint latency, and native memory
profiles are still required. A cold host session may still load its complete
runtime transcript when resuming. Ordinary visible text and realtime voice
history remain separate potential payload costs.

## Full history navigation

The newest eight messages paint first. A separate `get_session_history_index`
request then loads all message IDs, user/reply previews capped at 160 characters,
and compact markers. SQLite extracts only text previews, excluding tool bodies,
reasoning and metadata from the response. The capability is advertised in the
bootstrap; older hosts retain their existing loaded-history rail.

A tick outside the cache uses `load_session_messages` with `anchorId`, `direction`
and an eight-message limit. SQLite locates that message directly within the
session, without walking earlier pages. Both commands enforce project/session
access. The runtime retains current live rows when merging fetched pages and
returns only the requested page across the native bridge.

The rail represents the full timeline, including compact separators, independently
of the mounted transcript. Sparse cached pages carry gaps: moving up or down
requests the neighboring page before crossing a gap. Only a contiguous window is
mounted, with the existing 40-message ceiling. Live updates retain the reading
anchor; newer turns extend the index locally, and reconnect refreshes the baseline.
Late navigation responses cannot move a new session or override a newer jump.
Loading/failure feedback leaves the current transcript readable and offers retry.

Stories: **Chat/Mobile full history navigation** (full/empty/long history, index
loading/retry, and jump retry). Database, runtime and browser regressions cover
bounded payloads, direct seeking, both paging directions, compact navigation,
live updates, late responses and nonblocking first paint.
