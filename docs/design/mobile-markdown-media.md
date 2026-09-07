# Mobile markdown media (video / audio)

Status: investigated 2026-09-07, **deferred — mobile does not support markdown
video/audio for now**. The user decided to record the plan and revisit later.
Nothing in this document has been implemented.

Scope note: this came out of a desktop/mobile chat rendering parity audit. Every
other gap from that audit is tracked separately; this file covers only the media
half, which was explicitly carved out of that work.

## Problem

Desktop markdown dispatches `![](x.mp4)` / `![](x.mp3)` to real `<video>` /
`<audio>` players (`MediaImage` + `VIDEO_EXTS` / `AUDIO_EXTS` in
`apps/desktop/src/renderer/src/components/chat/chat-shared.ts`).

Mobile only has `NativeImage` in `packages/chat-view/src/PortableMarkdown.tsx`,
so the same markdown renders as a broken `<img>`.

## The three constraints that shape any solution

1. **The chat WebView has no origin.** `apps/mobile/src/screens/chat-screen.tsx:27`
   loads it as `source={{ html: CHAT_VIEW_HTML }}` with no `baseUrl`. No `file://`,
   no custom scheme, no relative URL resolution.

2. **Sanitize only allows `http` / `https` on `src`.** Streamdown's schema extends
   `hast-util-sanitize`'s `defaultSchema` but only adds protocols to `href`, so
   `protocols.src` stays `['http', 'https']`. `data:` URIs in markdown are
   stripped, and so are desktop's `local-file://` / `remote-media://`.

   Subtlety worth keeping: sanitize runs on the hast tree, so a **component
   override is not affected** — an `img` component that returns `<video>` renders
   fine. Only raw `<video>` tags written in the markdown source get stripped.
   Relaxing the schema is not required for the markdown path.

3. **Relay-delivered files are encrypted and short-lived.**
   `packages/relay-client/src/downloads.ts:137` rejects unencrypted files on the
   relay transport outright. The `chunked-v1` AES-GCM envelope means the whole file
   must land before anything can be decrypted, and decryption happens in RN JS —
   the WebView cannot do it. Presigned GET URLs expire after 60s
   (`apps/relay/src/r2-presign.ts:15`).

Consequence: **on the relay transport, media is inherently download-then-play, not
streaming.** No amount of budget changes that.

## Decision: option D — media chip, native playback

Render markdown media as a tappable chip that calls
`requestNative('previewFile', { path })`, reusing the existing download → decrypt →
native viewer flow.

Why this one:

- Zero new infrastructure; ~40 lines in `PortableMarkdown`.
- Consistent with how mobile already handles every other file — screenshots,
  ImageGen reference images and VideoGen outputs all go through `previewFile`.
  There is currently **no inline media of any kind** inside the mobile WebView;
  that is a convention, not an oversight.
- Fixes the actual present-day bug (broken `<img>`).

Rejected alternatives:

| Option | Why not |
|---|---|
| `data:` URI through the RN bridge | Stripped by sanitize; +33% size over a string bridge; a 30 MB video is not viable. Audio-only might be. |
| `file://` + `baseUrl` | Needs `allowFileAccessFromFileURLs` + `allowUniversalAccessFromFileURLs`, which dismantles the WebView sandbox boundary. |
| Local HTTP server in the app | Correct for streaming, but adds a native dependency (dev-client rebuild), port lifecycle, and lands decrypted plaintext on disk. Should be its own project if ever wanted. |

## Worth knowing: LAN already streams

`apps/desktop/src/main/lan-server.ts:359-404` implements **full HTTP Range
support** — parses `bytes=`, returns 206 with `Content-Range` and
`Accept-Ranges: bytes`, streams via `createReadStream(path, { start, end })`, 416
on a bad range. On the LAN transport `encryption` is `undefined`
(`apps/desktop/src/main/agent/agent-service.ts:1767`), so the URL is plain `http://`
and passes sanitize.

**So real streaming with seek already works on the same Wi-Fi today.** The only
missing pieces are the markdown component and raising the media TTL above the
current `ttlMs: 60_000`.

If inline media is ever picked up, the cheap first step is therefore: inline
playback on LAN, option D as the fallback everywhere else. That is a much smaller
change than it looks and does not depend on anything below.

## Cost of the relay path (if it were used)

Bytes never pass through the Worker or the Durable Object — `apps/relay/src/index.ts:20-22`
only signs URLs; desktop PUTs to R2 and the phone GETs from R2 directly.

- **R2 egress is free.** Bandwidth is not a cost driver.
- Ops are ~1 Class A + 1 Class B + ~2 Worker requests per file ≈ **$5.5 per
  million shares**, independent of file size.
- The only real cost is storage, and only because of the open question below.

## Open question: are staged R2 objects ever deleted?

No application code deletes desktop→phone staged objects. `deleteRelayFile` has
exactly one caller — `apps/desktop/src/main/remote/mobile-receive-service.ts:179`
— which is the phone→desktop direction. The Worker's Durable Object alarms
(`relay-session.ts:166`, `pairing-session.ts:89`) are WebSocket idle and pairing
timeouts, not object GC.

**This does not mean objects are never deleted.** R2 lifecycle rules are
bucket-level configuration and cannot be expressed in `wrangler.toml` at all —
they live in the Cloudflare dashboard or `wrangler r2 bucket lifecycle`. The repo
is simply silent on the matter.

To check:

```
wrangler r2 bucket lifecycle list super-one-file-staging
```

If no rule exists, one should be added regardless of this feature — presigned URLs
are valid for 60s, so objects surviving past a day serve no purpose. Images
already flow through this path today, so any leak is already accruing; video would
only multiply the slope.

## Evaluated and deferred: Tailscale Tailcat

[Tailcat](https://tailscale.com/blog/tailcat) (open sourced August 2026,
BSD-3-Clause, `github.com/tailscale/tailcat`) exposes Tailscale's data plane —
WireGuard encryption, NAT traversal, DERP rendezvous and fallback — with **no
account, no tailnet and no control plane**. A `tc<base64>` address carrying a
public key and DERP info is itself the bearer credential. It is userspace-only:
no TUN device, no routing table changes, so iOS needs no NetworkExtension
entitlement.

Its TCP port forwarding (`tailcat forward <addr> 18080:8080`) would let the phone
reach the desktop's file bridge directly, which removes every constraint above at
once: no presigned TTL, no `chunked-v1` envelope (WireGuard is already the E2E
layer), a plain `http://127.0.0.1:PORT` URL that sanitize accepts, and no R2.

Deferred anyway, for three reasons:

1. **Mobile is the wall.** Tailcat is a Go library and CLI. `apps/mobile` is an
   Expo dev-client; using it means gomobile bindings plus a native module, a
   dev-client rebuild, and a Go toolchain in mobile CI. Neither the announcement
   nor the README documents any mobile story.
2. **DERP would have to be self-hosted.** The default is Tailscale's free
   rate-limited relays (`tailcat.dev/derpmap.json`), which is not a basis for
   shipping user traffic. Running `cmd/derper` means operating stateful
   long-lived-connection servers again — precisely what the Workers + R2 design
   avoids.
3. **It would be a third transport.** `@superone/relay-client` already has `lan`
   and `relay` with pairing, crypto, ACK and RPC built out.

Given that LAN already streams, Tailcat's real value narrows to *"make the LAN
experience available when not on the LAN."* That may well be worth it — but it
should be justified by a general desktop↔phone data plane (terminal throughput,
large file transfer, wireless scrcpy preview), **not by markdown video**.

## Key files

- `packages/chat-view/src/PortableMarkdown.tsx` — mobile markdown runtime
- `apps/desktop/src/renderer/src/components/chat/chat-shared.ts` — desktop runtime, `MediaImage`
- `apps/mobile/src/screens/chat-screen.tsx` — WebView source
- `apps/mobile/src/shared-file-inbox.tsx` — download / decrypt / native preview
- `apps/desktop/src/main/lan-server.ts` — LAN file bridge with Range support
- `apps/desktop/src/main/agent/agent-service.ts` — `read_desktop_file` handler
- `apps/relay/src/r2-presign.ts`, `apps/relay/src/index.ts` — presigning only
