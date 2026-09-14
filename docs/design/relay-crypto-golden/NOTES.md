# Relay crypto golden vectors (WP-03)

Status: **spike_done** — 2026-08-21
Frozen trees (zero edits): `apps/desktop/src/main/remote-control-crypto.ts`, Flutter `lib/crypto.dart`
Vectors: [`vectors.json`](./vectors.json)

## Algorithm (unchanged)

- HKDF-SHA-256, salt empty, info `channel-key` / `aes-key`, 256-bit OKM
- AES-256-GCM, 12-byte IV prepended: `base64(IV || ciphertext || tag)`
- HMAC-SHA-256 over `${role}:${timestamp}` with channel key
- Room id: SHA-256(channelKey) hex, first 32 chars
- Chunked file envelope v1 / format 0x02; per-chunk AAD `${channelKeyHex}:${r2Key}:${index}`

Master secret is the existing test fixture `'0123456789abcdef'.repeat(8)` (128 hex chars).

## Cross-language decode (unmodified ciphertext)

| Consumer | Result |
|----------|--------|
| Desktop WebCrypto `decryptPayload` / `decryptBytesChunked` | **pass** (`remote-control-crypto.golden.test.ts`) |
| Flutter `crypto.dart` 1.0.0+19 | **pass** (ad-hoc `dart run`, no Flutter tree edit) |
| `@noble/ciphers@2.3.0` + `@noble/hashes@2.3.0` | **pass** (HKDF + AES-GCM + chunk AAD) |

## Library choice for `@superone/relay-client` (WP-08)

**`@noble/ciphers` + `@noble/hashes`.** No `react-native-quick-crypto`. RN needs a `getRandomValues` polyfill for encrypt; decrypt of desktop frames does not.

Do not edit the frozen desktop / Flutter crypto implementations for this package. WP-08 copies the algorithm into pure TS using noble.

## Do not regenerate

Ciphertexts include random IVs. Regenerating changes the JSON. Only recapture if HKDF/AES parameters change.


## Host application framing (2026-09-14)

[`host-payload-v1.json`](./host-payload-v1.json) adds frozen raw and deflated host
application vectors. `vectors.json` continues to cover pairing and chunked file
crypto; it is not the application-frame decoder.

After AES-GCM opening, host application plaintext is `flag:u8`, original JSON
byte length as `u32be`, then raw JSON or raw DEFLATE. The five-byte header is
authenticated. JSON is capped at 32 MiB, ciphertext/chunk assembly at the derived
base64 bound. Unknown flags, corrupt data, size mismatches and oversize frames
are rejected. All current LAN and relay consumers use this one contract; there
is no legacy application decoder or version negotiation.

The host uses asynchronous zlib; the phone uses direct `fflate@0.8.2` with a fixed
output buffer. Local WebCrypto-to-phone-decoder and real LAN socket tests pass.
The separate native crypto backend can replace noble for AES without changing
these bytes. Relay envelopes and control messages are unchanged: compression
is inside the encrypted payload. Only desktop and phone need this decoder
upgrade; no relay deployment or startup replay reset is required. Existing
pairings and draft outboxes remain intact.
