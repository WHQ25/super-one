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

## Integration gaps

| # | Gap | Effect | Decision |
|---|---|---|---|
| G1 | Realtime voice works only on the official Codex account (`codex-realtime.ts#startCodexRealtime` refuses other providers; `#listCodexRealtimeTimeline` returns an empty timeline for them) | Custom API providers have no voice | open |
| G2 | The phone cannot start or carry a Codex voice call: no WebRTC dependency in `apps/mobile`, no remote path to `thread/realtime/start`; it only shows the transcript segments restored from desktop | Voice is desktop-only | open. Direction: desktop keeps owning Codex (account, thread, tools). The phone's media connects directly to OpenAI first: the phone makes the SDP offer, sends it over the authenticated control channel, desktop calls `thread/realtime/start` and returns the answer to that phone only. Desktop-proxied media is the fallback, trying LAN / P2P before TURN. A call is ready only once media flows and plays, not on the SDP answer or `realtime_started`. Audio never rides the relay chat-event path. |
