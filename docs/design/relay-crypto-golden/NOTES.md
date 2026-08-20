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
