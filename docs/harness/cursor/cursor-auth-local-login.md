# Cursor authentication

SuperOne authenticates SDK calls with a Cursor User API Key. Users can paste a
key or use the SDK's browser-login flow. Existing Cursor IDE login state is not
read from `state.vscdb`, cookies or Keychain.

## Browser login

`packages/cursor/src/cursor-sdk-auth.ts` wraps `Cursor.auth.login`, `status` and
`logout`. Desktop `CURSOR_SDK_LOGIN` opens the login URL, names the key SuperOne,
encrypts the returned key into the base provider config and marks sessions for
rebuild. It returns email/expiry metadata to the UI, not the plaintext key.

The SDK's default login store is `~/.cursor/sdk/auth.json`. The wrapper can opt
out with `skipSdkStore`; the current desktop login call uses the default. The
vault copy and SDK store are separate. `Cursor.auth.logout()` drops SDK login
state, but the desktop logout handler does not clear the copied provider key or
revoke it at Cursor. The UI must not imply those effects.

## Runtime key resolution

Desktop `main/cursor/cursor-auth.ts` decrypts SuperOne's credential value.
Electron-free `resolveCursorApiKeyPlain` accepts plaintext config or
`CURSOR_API_KEY`, and does not mistake an encrypted `enc:v1:` value for a usable
key. Create/resume/API helpers receive the resolved key explicitly.

The local agent's workspace store is conversation state, not an authentication
store. Do not switch process-wide credentials or stores when a session opens.

## Boundary

SDK authentication is a supported browser/key flow, not a reuse of private IDE
session tokens. The earlier 1.0.24 investigation predated the login wrapper and
must not be used to conclude that browser login is unavailable. Current pin
information is in [README](README.md); behavior above is grounded in the checked-in
wrapper and IPC implementation.
