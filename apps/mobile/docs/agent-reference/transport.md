# Mobile transport and restore

The device list discovers desktops over mDNS through the local `modules/lan-browser`
Expo module (`_superone._tcp`, matched to a pairing by the `roomId` TXT key) and probes
reachability without a raw socket: the relay's `/status` room endpoint for the cloud
route, and an HTTP GET against the desktop LAN server — which answers `426 Upgrade
Required` — for the local one. The native module is optional at import; a dev client
built before it existed degrades to relay-only discovery. Both the probe and the
LAN socket are plain `http://` / `ws://`, so the release Android build needs
`android:usesCleartextTraffic="true"` on the *main* manifest — Expo only writes it into
the debug variants, which is why LAN worked in the dev client and silently fell back to
relay in the `internal` APK. `expo-build-properties` in `app.json` owns that flag; iOS
already allows it through ATS `NSAllowsLocalNetworking`.
**The desktop's LAN port is ephemeral** (`port: 0`), so the address stored at pairing
time is dead after the next desktop launch and mDNS is the only way to the live one —
and neither platform re-resolves a Bonjour name it has already reported: Android's
`DiscoveryListener` fires `onServiceFound` once and a one-shot `resolveService` answers
from the system's mDNS cache (which can still hold the old SRV), `NWBrowser` on iOS
never revisits a result whose TXT is unchanged. So the Android module keeps a
`ServiceInfoCallback` per service (API 34+, `onServiceUpdated` carries the new port),
a `reset` refresh (mount, foreground, pull-to-refresh) **restarts** the browse rather
than reusing it, and `LanServiceCache` keeps *every* address a room is advertised at —
after an unclean desktop restart the dead port sits beside the live one (often under
`name (2)`) until its record expires — and discovery probes all of them. Terminal
frames use `RelayClient.send` / `onTerminal` and never ACK. The separate terminal
document embeds xterm.js, prefers the patched WebGL renderer, falls back to canvas,
and reports input and bounded resize messages to RN.

## Relay transport invariants

- `RelayClient` owns exactly one active socket. Connecting through LAN replaces relay,
  and connecting through relay replaces LAN.
- Open/reconnect starts event buffering before replay. Session restore then runs
  subscribe → history → snapshot → release; a server `reset` discards pre-reset
  batches and triggers the same restore path.
- Transport loss retries with bounded backoff until it succeeds or a manual connection
  cancels the loop. A reopened socket is still `reconnecting`: publish `connected` and
  the new epoch only after rehydrate releases the buffer. **An open relay socket says
  nothing about the desktop** — the relay accepts a lone mobile as a mailbox — so a
  reopened *relay* socket asks `/status` before restoring; a desktop that is away parks
  the connection as `offline` (socket held, loop stopped, device row shows discovery's
  verdict) and the desktop's next `handshake` runs the restore. `peer_disconnected` is
  the same `offline`. Without the probe every retry burned three 15 s request timeouts
  and painted `Reconnecting…` for a desktop that was simply off. LAN never probes: there
  the desktop *is* the socket peer. Re-send the current connection
  snapshot whenever the Chat WebView reports `ready` after a renderer reload.
- Opening and creating sessions are mutually exclusive because every restore uses the
  client's single event buffer. Validate new-session worktree input before unsubscribing
  the current session; on transition failure, dispose the incomplete runtime and reopen
  the workspace drawer instead of leaving a stale chat detail active.
- Released buffers assign the runtime epoch. Live batches from older epochs are
  dropped, and overlapping restores may only commit their newest generation.
- Script-fatal errors and native iOS/Android WebView process exits reload and
  hydrate the chat document, bounded to two reloads per 10-second window.
- Transcript paints use `TranscriptDelivery`: one unacknowledged projection plus
  one coalesced latest snapshot. The document emits `transcriptApplied`; a missing
  receipt retries the same projection after 1s, including the final idle paint.
  Only acknowledged paints can be followed by a diff. Hydrates supersede pending
  work; the document acknowledges duplicates without reapplying them. Keep native
  permission state updates outside this document queue.
- Only relay `event` envelopes advance or emit cumulative ACKs. LAN and terminal
  frames never produce relay ACKs.
- Development builds log only decrypted `AgentEvent.type` values, never event payloads
  or pairing secrets.
