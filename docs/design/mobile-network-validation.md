# Mobile network and attachment validation

2026-09-14 — local worktree validation. Mandatory implementation: attachments,
transport ledger, request/cache changes, compression and event coalescing.
C3–C5 and B2 remain conditional on representative device traffic.

## Repeatable payload benchmark

Run `bun apps/desktop/scripts/benchmark-mobile-payload.ts` from the repository root.
It uses deterministic synthetic catalogs, history, random binary encoded as
base64, and sequenced text deltas. No accounts or network services are used.
Numbers below are serialized WebSocket envelope bytes, including AES-GCM and
base64 overhead; TCP/TLS/WebSocket headers are not measured.

| Fixture | JSON bytes | Previous envelope | Framed/compressed envelope |
| --- | ---: | ---: | ---: |
| Small acknowledgement | 11 | 103 | 111 |
| 60-model catalog | 6,952 | 9,359 | 667 |
| Repetitive 200-message history | 308,804 | 411,827 | 4,255 |
| 256 KiB random binary as base64 | 349,541 | 466,143 | 351,167 |

The deliberately repetitive history is a compression stress fixture, not an
estimate of normal conversations. Small messages grow by the authenticated
header; large binary base64 still shrinks, even when its decoded bytes have
little redundancy. Production savings depend on the payload mix.

A synthetic source delivering 500 sequenced deltas/second, flushed in groups of
16 within a 33 ms window, produces **13 frames instead of 200**, and **4,192
bytes instead of 44,364**. Every event sequence is retained. Real cadence and
control boundaries change the number of batches.

The script reports median encode/decode elapsed times after warm-up. These are
local Bun/WebCrypto/noble measurements, not Hermes or end-to-end phone latency.
Host compression uses the asynchronous zlib worker pool. On-device ledger rows
separate command encode, AES decrypt, inflate/JSON decode, RPC latency, envelope
bytes and local hydration/restore milestones.

## Scope and remaining field checks

Scoped tests cover shared attachment admission and disk failures; Claude/ACP
input shape; CLI Codex normal/steered localImage inputs; runtime admission
receipts; cache restart/Forget, trimming and cursor retention; pending read
coalescing; liveness probes; compression golden vectors and bounds; LAN replies
and broadcasts; sequenced batches, recipient separation and disconnect. A regression test also
checks that slower compressed terminal output cannot be overtaken by exit.

Native preview: `superone-dev://native-preview?page=Network%20ledger` exposes the
same production diagnostic component's traffic/reset, narrow and empty stories.
Native iOS 26.4 preview rendering and reset were verified at 400 px and 280 px;
the dark empty state uses the theme text color. The isolated preview was closed
after verification.

Desktop composer stories: `Chat/ChatComposerShell/InvalidAttachment` and
`Chat/ChatComposerShell/AttachmentSaveRetry`.

## Self-review corrections

The 2026-09-14 review found and corrected these issues:

- Startup replay clearing was unnecessary for this development-stage change
  and could make phones stop reconnecting. Startup now sends only the existing
  handshake; no relay protocol change or deployment is required. Existing
  replay reset plus handshake still shares one restore on the phone.
- Attachment receipts could succeed before session lookup, ownership or send
  admission. Session admission now triggers success; refusal preserves the draft.
- A response compressed across a relay reconnect could use the new socket.
  Responses are bound to their original connection and host generation.
- Warm-connect background initialization could clear newly typed drafts or
  overwrite a newer project selection. Initialization happens before cached
  content is exposed; late branch/project responses check their request generation.
- Cached transcripts were hydrated behind the conversation loading cover.
  The runtime now tells the shell to uncover the cached page before subscribe
  completes. Story: `Mobile/ChatScreen/CachedSessionRevalidating`.

The self-review's related scoped tests passed, with 21 existing skips. This includes
real local LAN/relay sockets, session ownership/refusal, cached hydration, RN
screen/composer state, ACK/replay, and mixed GIF/PNG delivery. Desktop main,
mobile and relay typechecks and `git diff --check` passed. Full suites were not
run. Warm-cache navigation and draft preservation still need linked-phone
interaction coverage alongside the field checks below.

After removing startup replay clearing, 97 focused desktop/mobile transport
tests and the desktop main typecheck passed. The relay workspace has no diff;
startup and redial tests require only the existing handshake control frame.

No live provider turns or production relay deployment are part of these local
checks. Still measure matched Claude/Codex/ACP image turns (no extra Read), native
Hermes timings, warm-connect logical requests, and time to a painted screen on a
real linked phone. Ledger milestones measure hydration dispatch / completed
restore, not the display compositor's paint time. Choose C3–C5/B2 from those
measurements; synthetic compression gains alone do not justify new RPC shapes.
