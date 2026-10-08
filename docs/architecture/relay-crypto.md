# Relay crypto

End-to-end encryption between a paired desktop host and the phone. The relay
only sees ciphertext. The desktop implementation is
`apps/desktop/src/main/remote-control-crypto.ts` (WebCrypto); the phone and other
TS consumers use `packages/relay-client/src/crypto.ts`. Both must produce and
accept the same bytes, which the golden vectors pin.

## Algorithm

- HKDF-SHA-256, empty salt, info `channel-key` / `aes-key`, 256-bit output.
- AES-256-GCM with a 12-byte random IV: `base64(IV || ciphertext || tag)`.
- Auth: HMAC-SHA-256 over `${role}:${timestamp}` with the channel key.
- Room id: first 32 hex characters of SHA-256(channel key).
- Files: chunked envelope, format `0x02`; each chunk's AAD is
  `${channelKeyHex}:${r2Key}:${index}`.

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

Node traffic between desktops (and, later, through the relay) uses a
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

The phone LAN link does not use this channel yet; its `register` frame still
trusts a bare device id and its frames carry no sequence number.

## Golden vectors

- [`relay-crypto-vectors.json`](../../packages/relay-client/src/fixtures/relay-crypto-vectors.json):
  pairing derivation, payload and chunked-file ciphertexts. Checked by
  `apps/desktop/src/main/remote-control-crypto.golden.test.ts` and
  `packages/relay-client/src/crypto.test.ts`.
- [`host-payload-v1.json`](../../packages/relay-client/src/fixtures/host-payload-v1.json):
  raw and deflated host application frames, checked by
  `packages/relay-client/src/host-payload.test.ts`.

- [`secure-channel-vectors.json`](../../packages/relay-client/src/fixtures/secure-channel-vectors.json):
  node channel secret derivation, handshake proofs, direction keys and a sealed
  frame with fixed nonces and IV. Checked, including against `node:crypto`, by
  `packages/relay-client/src/secure-channel.test.ts`.

The master secret is the test fixture `'0123456789abcdef'.repeat(8)`. Ciphertexts
contain random IVs, so regenerating changes every value: recapture only when an
algorithm parameter changes, and then update both implementations together.
