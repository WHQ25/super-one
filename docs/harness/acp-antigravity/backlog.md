# Antigravity (ACP) capability backlog

| Capability | Introduced | Benefit | Cost / Risk | Decision | Reason |
|---|---|---|---|---|---|
| SuperOne R2 mirror for `agy-acp-server` archives | 1.3.0 | Faster fallback in regions where `dl.google.com` is slow | Requires release sync pipeline updates | `rejected` | User requested direct download from Google (`dl.google.com`) without R2 mirror sync for now |
| Structured multi-answer payload back to `agent_ask_user` | 1.3.0 | Returns free-text answers directly inside `RequestPermissionResponse._meta` | Antigravity ACP `RequestPermissionResponse` currently only consumes standard `selected` / `cancelled` option outcomes | `open` | Revisit when upstream ACP schema documents structured answer fields on `RequestPermissionResponse` |
| Native ACP `logout`, `session/list`, and `session/close` RPCs | 1.5.3 | Direct wire sign-out and session enumeration | SuperOne already owns auth state (`AntigravityAuthService`) and SQLite session lifecycle across harnesses | `rejected` | Redundant with host-managed auth and session lifecycle |
