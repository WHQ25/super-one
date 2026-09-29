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

## Golden vectors

- [`relay-crypto-vectors.json`](../../packages/relay-client/src/fixtures/relay-crypto-vectors.json):
  pairing derivation, payload and chunked-file ciphertexts. Checked by
  `apps/desktop/src/main/remote-control-crypto.golden.test.ts` and
  `packages/relay-client/src/crypto.test.ts`.
- [`host-payload-v1.json`](../../packages/relay-client/src/fixtures/host-payload-v1.json):
  raw and deflated host application frames, checked by
  `packages/relay-client/src/host-payload.test.ts`.

The master secret is the test fixture `'0123456789abcdef'.repeat(8)`. Ciphertexts
contain random IVs, so regenerating changes every value: recapture only when an
algorithm parameter changes, and then update both implementations together.
