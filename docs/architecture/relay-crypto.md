# Relay crypto

End-to-end encryption between a paired desktop host and the phone. The relay
only sees ciphertext. Every phone holds its own channel secret; phone frames use
the [encrypted channel](#node-encrypted-channel) below, the same construction
the node link uses ([phone link](#phone-link)). The static-key primitives live in
`apps/desktop/src/main/remote-control-crypto.ts` (WebCrypto) and
`packages/relay-client/src/crypto.ts`; both must produce and accept the same
bytes, which the golden vectors pin.

## Static-key primitives

- `deriveKeys`: HKDF-SHA-256, empty salt, info `channel-key` / `aes-key`, 256-bit output.
- AES-256-GCM with a 12-byte random IV: `base64(IV || ciphertext || tag)`. Only
  the pairing exchange uses this, under the QR's temporary key.
- Room id: first 32 hex characters of SHA-256(channel key). The host room is
  derived from the host root (`RemoteDeviceConfig.masterSecret`).
- Relay file requests: HMAC-SHA-256 over `${role}:${timestamp}` with the host
  room's channel key; the relay checks it and the `files/<room>/` key prefix.
- Files: chunked envelope, format `0x02`, sealed under `deriveKeys(phone secret)`
  of the phone that sends or receives it; each chunk's AAD is
  `${channelKeyHex}:${r2Key}:${index}` with that phone's channel key.

## Pairing

The desktop shows a QR with a one-time channel id and a 32-byte temporary key.
The phone sends `pair_request { code, mobileDeviceId, deviceName }` sealed under
the temporary key through the relay's pairing room; after the user confirms the
code, the desktop answers `pair_response` under the same key with
`{ credential: { keyId, secretHex }, roomId, hostName, relayUrl }`. The key id is
16 fresh random bytes (hex); the secret is the issued channel secret below,
derived from the root, so the desktop stores only the key id
(`paired_devices.channel_key_id`). The root never leaves the desktop. Removing a
device deletes its key id, so its secret no longer resolves; re-pairing issues a
new key id.

Pairings made before per-device secrets carried the root itself. The desktop
rotates such a root once (`RemoteDeviceConfig.channelScheme`), and lists rows
without a key id as needing re-pair; the phone marks saved pairings without
`keyId`/`roomId` the same way. A phone receiving a `pair_response` with a bare
`masterSecret` reports that the desktop must be updated.

## Crypto backends

`packages/relay-client/src/crypto-backend.ts` isolates AES-GCM and base64. The
default is `@noble/ciphers` (pure JS, used by tests and Node). Pure-JS AES-GCM is
too slow on Hermes for attachments, so the phone installs an OpenSSL-backed
implementation from `react-native-quick-crypto` at startup
(`apps/mobile/src/native-crypto.ts`). A backend changes speed, never bytes.

## Host application framing

After AES-GCM opening, a host application frame is `flag:u8`, the original JSON
byte length as `u32be`, then raw JSON or raw DEFLATE. The five-byte header is
inside the authenticated plaintext. JSON is capped at 32 MiB, and ciphertext or
chunk assembly at the matching base64 bound. Unknown flags, corrupt data, size
mismatches and oversize frames are rejected. LAN and relay use this one contract;
there is no version negotiation. The host compresses with Node zlib
(`apps/desktop/src/main/remote/payload-codec.ts`), the phone decodes with
`fflate` (`packages/relay-client/src/host-payload.ts`). Compression sits inside
the encrypted payload, so relay envelopes and control messages are unaffected.

When and how the host decides to compress, and the rest of the phone ↔ host
protocol, are in [mobile-remote-control.md](mobile-remote-control.md).

## Node encrypted channel

Node traffic between desktops, and phone traffic to its host, uses a
per-connection channel keyed by a pairing secret that is exchanged out of band
and never sent over the network. Implementation:
`packages/relay-client/src/secure-channel.ts` (noble, so it also runs on
Hermes); the Node `ws` client half is
`packages/runtime/src/server/secure-channel-client.ts`. Where node servers use
it is described in [remote-node-service.md §11.3](remote-node-service.md).

- Keys: `deriveKeys(secret)` from above gives the HMAC key (`channel-key`) and the
  base key (`aes-key`). A node derives each pairing's secret as
  HMAC-SHA-256(root, `superone-channel/v1|secret|${keyId}`).
- Handshake, JSON text frames with `v: 1`:
  1. client → `channel_hello { keyId, nonce }` (32 random bytes, hex)
  2. node → `channel_challenge { nonce, proof }`
  3. client → `channel_proof { proof }`

  Each proof is HMAC-SHA-256(HMAC key,
  `superone-channel/v1|${role}|${keyId}|${clientNonce}|${serverNonce}`) with role
  `server` or `client`, compared in constant time. The client checks the node's
  proof before it reveals its own. A wrong secret or an unknown key id fails the
  same way.
- Direction keys: HKDF-SHA-256(base key, salt `clientNonce || serverNonce`, info
  `superone-channel/v1|c2s` or `|s2c`, 32 bytes). They are fresh per connection,
  so a frame captured on one connection fails authentication on any other.
- Frames, binary: `IV(12) || AES-256-GCM(seq:u64be || JSON)` with AAD
  `superone-channel/v1`. Each direction numbers its frames from 1, and the
  receiver rejects any sequence number that is not higher than the last one it
  accepted (replay, reorder). The node's first frame is `channel_ready`.

Frame bodies are bytes (`sealChannelBytes`); the node channel's bodies are JSON.

## Phone link

`packages/relay-client/src/phone-link.ts` (phone, `RelayClient`) and
`apps/desktop/src/main/remote/phone-link-host.ts` (host, LAN server and relay
connection) run the channel above over JSON text envelopes:

- Handshake: `{ type: 'channel', msg }` carries hello, challenge and proof. A
  challenge echoes the hello's nonce in `hello`, so the phone ignores one for an
  older hello. The host resolves the key id to the paired device; over the relay
  that device must also own the relay slot the hello came from. An unknown or
  revoked key id is answered with `kicked`. After the proof the host sends
  `{ type: 'channel', data }`, a sealed `handshake` frame (host name, LAN
  addresses); only then does the phone send requests.
- Frames: `command`, `event`, `response`, `response_chunk` and `terminal` keep
  their envelopes, and `data` is one sealed channel frame, base64. The sealed
  body is `headerLen:u16be || header JSON || payload`; the header names the kind
  (and request id), so a relabelled frame fails. Host payloads are the host
  application frame below; commands are raw JSON. The header is capped at
  1 KiB (`REMOTE_LINK_HEADER_MAX_BYTES`).
- Channels are per connection. A LAN socket handshakes once; a relay phone
  handshakes when its socket opens and again whenever the relay announces the
  desktop (`peer_connected`). The host seals each event once per phone channel
  and addresses relay copies to that phone alone; responses are bound to the
  channel their command arrived on. Replayed, reordered or tampered frames fail:
  a LAN socket is closed, a relay command is dropped.
- Frames sealed for an earlier connection cannot be opened, so the phone does
  not ask the relay to replay: it rebases its ACK watermark on the first seq of
  the new connection and restores the session (see
  [mobile-remote-control.md](mobile-remote-control.md)).
- Cleartext control frames remain: `kicked`, `desktop_shutdown`,
  `peer_connected` / `peer_disconnected`, `ack`. Anyone who knows the room id
  (any paired phone, including a removed one) can still send them or occupy a
  relay slot: the relay does not authenticate room members. They cannot read or
  forge frames.

The desktop installs a `node:crypto` AES-GCM backend for the shared code and
loads it lazily, outside the startup chunk.

## Node channel over the relay

`packages/runtime/src/server/relay-node-link.ts` carries the node encrypted
channel through the same relay, in the phone link's `channel` envelope:

- Room: `desktop` is the node; the room id is the first 32 hex characters of
  HMAC-SHA-256(channel root, `superone-channel/v1|relay-room`). Every client
  connection opens its own `mobile` slot `node-<uuid>`, so one connection's
  frames never mix with another's.
- Frames: a handshake text frame travels as `{ type: 'channel', msg }`; a sealed
  binary channel frame as base64 `data`, split into parts of at most
  `REMOTE_RESPONSE_CHUNK_CHARS` with `more: true` on all but the last. Frame
  bytes are unchanged; the assembled frame is capped at the node's 12 MiB
  WebSocket limit.
- Closing: the node ends a slot with `{ type: 'kicked', code, reason }`; a client
  slot also closes on `peer_connected`, `peer_disconnected` and
  `desktop_shutdown`, since the node's channel for it is gone.
- The relay sees the room id, slot ids, the key id in the hello and frame sizes.
  Room membership is not authenticated (see the phone link above).

## Golden vectors

- [`relay-crypto-vectors.json`](../../packages/relay-client/src/fixtures/relay-crypto-vectors.json):
  pairing derivation, payload and chunked-file ciphertexts. Checked by
  `apps/desktop/src/main/remote-control-crypto.golden.test.ts` and
  `packages/relay-client/src/crypto.test.ts`.
- [`host-payload-v1.json`](../../packages/relay-client/src/fixtures/host-payload-v1.json):
  raw and deflated host application frames (sealed under a fixed static key for
  the fixture), checked by `packages/relay-client/src/host-payload.test.ts`.
- [`secure-channel-vectors.json`](../../packages/relay-client/src/fixtures/secure-channel-vectors.json):
  issued secret derivation, handshake proofs, direction keys, a sealed JSON frame
  and a sealed phone link frame with fixed nonces and IVs. Checked, including
  against `node:crypto`, by `secure-channel.test.ts` and `phone-link.test.ts`.

The master secret is the test fixture `'0123456789abcdef'.repeat(8)`. Ciphertexts
contain random IVs, so regenerating changes every value: recapture only when an
algorithm parameter changes, and then update both implementations together.
