# Codex backlog

Unused upstream capabilities and gaps, and the decision on each. Decisions:
`open`, `adopt` (link the upgrade doc that lands it), `rejected` (keep the
reason). Behavior these rows rely on: [contracts.md](contracts.md).

## Capabilities

| # | Capability | Since | Benefit | Cost / risk | Decision |
|---|---|---|---|---|---|
| 1 | `ThreadRealtimeStartParams.clientManagedHandoffs` | ≤0.150.1 | SuperOne decides when and what Codex output reaches the voice model | Replaces the automatic `bemTags` handoff with client-owned timing and content; changes the data flow and its failure boundaries | open |
| 2 | `ThreadRealtimeStartParams.codexResponsesAsItems` (+ `codexResponseItemPrefix`) | ≤0.150.1 | Codex responses enter the voice conversation as items instead of handoff appends | Unclear gain over automatic handoff; changes what the voice model hears | open |
| 3 | `bemItemPromoted` realtime items (`turn_id`, `item_id`, `presentation`) | ≤0.150.1 | Explicit link from a voice entry to the backing Codex turn ("view Codex turn") | Timeline and item mappers read only `transcriptSegment`; delegated turns are placed by timeline position today | open |
| 4 | Non-transcript realtime items: `thread/realtime/itemAdded`, and `item/started` / `item/completed` for kinds other than `transcriptSegment` | ≤0.150.1 | Session and promoted-item lifecycle in the live UI | `codex-realtime.ts#mapRealtimeTranscriptItem` maps transcript segments only; `itemAdded` carries untyped JSON | open |
| 5 | `thread/realtime/appendAudio` + `thread/realtime/outputAudio/delta` (websocket transport) | ≤0.154.0 | Host-side audio in and out, the basis of a desktop-proxied phone call | Transport and audio format unverified in practice; SuperOne only uses the WebRTC transport | open, see G2 |
| 6 | `features.instant_interrupt` | 0.159.0 | Steering can reach the model during long code-mode calls | Live `experimentalFeature/list` reports `underDevelopment`, disabled by default; validate tool cancellation and queued-message ownership before enabling | open; recommended follow-up after upstream stabilizes it |
| 7 | Item anchors in `thread/items/list`, plus item start/completion timestamps | 0.159.0 | Load long provider histories around a selected item and reconstruct tool durations | SuperOne still reads full provider history and has its own persisted transcript pagination; needs a native-history adapter and source-ID mapping | open; recommended history-performance follow-up |
| 8 | `ThreadItem.mcpAppUi` and `mcpServer/resource/read.target` | ≤0.159.0 | Render native MCP Apps using the descriptor's resource URI/display preference and explicit connector/link routing | Both chat mappers currently omit presentation metadata; resource auth targeting and desktop/mobile/remote rendering need one shared contract | open; recommended MCP Apps integration follow-up |
| 9 | `account/gatewayOAuth/{login,read,cancel}`, `InitializeCapabilities.explicitGatewayOauth`, workspace routing | ≤0.159.0 | Explicit login for gateways and selected workspaces | Existing official-account/custom-provider routing works without it; do not enable the capability before implementing all login lifecycle paths | open; integrate when gateway accounts are in product scope |
| 10 | OAuth client secrets for MCP servers | 0.158.0 | Connect to MCP servers requiring a pre-registered OAuth client | Upstream runtime supports it; SuperOne's MCP configuration UI has no secret entry/storage flow | open; use the existing credential store if needed |
| 11 | `ThreadRealtimeStartParams.backendReasoningStatus` | ≤0.159.0 | Voice UI can distinguish delegated reasoning from silence | WebRTC events and desktop/mobile transcript projections need live verification before surfacing the state | open |
| 12 | `PluginDetail.onboardingSkill` | ≤0.159.0 | Guide a user through newly installed plugin setup | Needs an explicit user-triggered onboarding action and consistent desktop/remote behavior | open |
| 13 | `Model.availableAccessPrograms` | ≤0.159.0 | Describe model-specific access programs in the picker | Metadata is currently ignored; semantics and account/UI states need verification | open |
| 14 | Saved `disabledPluginIds` on thread/turn settings | ≤0.159.0 | Future plugin selection per conversation | Upstream schema explicitly says the IDs do not yet filter plugin capabilities; a toggle would promise behavior the runtime does not enforce | open; wait for enforced filtering before exposing controls |
| 15 | `rollout/compress` | ≤0.159.0 | Compress persisted provider rollouts | Experimental storage operation; separate from context compaction and SuperOne's session lifecycle | open; no current call |

The 0.159.0 review also includes runtime-native transparent image generation and
file-backed image edits (0.158.0). Existing attachment/image-result paths can carry
them without a new client RPC or UI control; actual image generation was not part
of this upgrade's smoke test. Gateway, worktree/daemon and terminal UI features
must not replace SuperOne's existing account, worktree and rendering ownership.

## Integration gaps

| # | Gap | Effect | Decision |
|---|---|---|---|
| G1 | Realtime voice works only on the official Codex account (`codex-realtime.ts#startCodexRealtime` refuses other providers; `#listCodexRealtimeTimeline` returns an empty timeline for them) | Custom API providers have no voice | open |
| G2 | The phone cannot start or carry a Codex voice call: no WebRTC dependency in `apps/mobile`, no remote path to `thread/realtime/start`; it only shows the transcript segments restored from desktop | Voice is desktop-only | open. Direction: desktop keeps owning Codex (account, thread, tools). The phone's media connects directly to OpenAI first: the phone makes the SDP offer, sends it over the authenticated control channel, desktop calls `thread/realtime/start` and returns the answer to that phone only. Desktop-proxied media is the fallback, trying LAN / P2P before TURN. A call is ready only once media flows and plays, not on the SDP answer or `realtime_started`. Audio never rides the relay chat-event path. |
