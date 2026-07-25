# Research: Can SuperOne use local Cursor desktop login for `@cursor/sdk`?

| Field | Value |
|---|---|
| **Status** | Research note |
| **Date** | 2026-07-25 |
| **SDK** | `@cursor/sdk@1.0.24` |
| **Related** | `cursor-sdk-harness.md` (open question Q1) |
| **Machine probe** | macOS; Cursor app present; desktop session logged in; `cursor-agent` installed |

## Short answer

**No — not via any supported SDK API.**

`@cursor/sdk` authenticates only with a **User API Key** (`AgentOptions.apiKey` or `process.env.CURSOR_API_KEY`). It does **not** read the Cursor desktop app login session, Keychain items, or `state.vscdb` tokens.

Reusing the desktop session would require **unofficial scraping** of Cursor’s private credential stores. That is fragile, likely ToS-sensitive, and should not be the default SuperOne auth path.

---

## Evidence (SDK 1.0.24)

### Public surface

- All cloud/account calls (`Cursor.me`, `Cursor.models.list`, `Cursor.repositories.list`, cloud agent ops) take `apiKey?: string` and fall back to `CURSOR_API_KEY` only.
- `Cursor.configure` configures **local store / HTTP1**, not credentials.
- `settingSources` (`project` \| `user` \| `team` \| `mdm` \| `plugins` \| `all`) loads **settings layers** (rules, MCP, hooks, plugins) from disk — **not** auth tokens.
- `AuthenticationError` docs mention “Invalid API key, not logged in…” as error class examples; there is still no “use desktop login” option.

### Wire path for API keys

From bundled SDK JS:

1. Resolve key: explicit `apiKey` else `process.env.CURSOR_API_KEY`.
2. Empty string key **refuses** env fallback.
3. Exchange: `POST ${backend}/auth/exchange_user_api_key` with `Authorization: Bearer <apiKey>` → returns `accessToken`.
4. Subsequent backend traffic uses the exchanged access token (Bearer), against hosts such as `https://api2.cursor.sh` / `https://api.cursor.com`.

So the product credential SuperOne is expected to hold is a **User API Key** that can be exchanged — not the desktop session JWT itself (unless a probe proves the JWT is accepted in place of an API key, which is undocumented).

### What the SDK does **not** reference

Grep of packaged SDK JS found **no** references to:

- `cursorAuth/*`
- `state.vscdb`
- `Application Support/Cursor` auth paths
- `cursor-access-token` / keychain service names
- `auth.json` credential files

---

## What local Cursor actually stores (desktop)

On a logged-in macOS machine (probe, secrets redacted):

| Store | Keys / items | Shape (probe) |
|---|---|---|
| `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` → `ItemTable` | `cursorAuth/accessToken`, `cursorAuth/refreshToken`, `cursorAuth/cachedEmail`, membership fields | JWT-like strings (~401 chars, 3 segments) for tokens; email present |
| macOS Keychain | services `cursor-access-token`, `cursor-refresh-token` (account `cursor-user`); also `Cursor Safe Storage` | Present |
| `~/.cursor/cli-config.json` | model prefs, privacy cache, statsig bootstrap | **No** API key field |

Interpretation:

- Desktop login = **OAuth-style session** (access + refresh JWTs), not a User API Key.
- SDK expects a **User API Key** that is exchanged into an access token.
- These are related identity systems but **not the same credential type** in the public integration model.

---

## Cursor Agent CLI (adjacent product)

`cursor-agent` (`~/.local/bin/cursor-agent`) supports:

```text
--api-key <key> | CURSOR_API_KEY
agent login     # browser login
agent logout
agent status | whoami
```

Docs/community guidance: User API Keys from **Settings → Integrations → User API Keys** (`cursor.com/settings`); Admin keys do not work for CLI. Browser `agent login` is an alternative for the CLI.

CLI auth is **separate product surface** from `@cursor/sdk`. Even when the CLI is “logged in”, the SDK still needs an API key (or env) unless SuperOne reimplements the CLI’s private credential manager.

On this machine: `agent about` reported **User Email: Not logged in** while desktop `cursorAuth/cachedEmail` existed — reinforcing that **desktop session ≠ agent CLI session ≠ SDK key**.

---

## Options for SuperOne (ranked)

### A. Official — User API Key in SuperOne vault (**recommended**)

1. Settings UI: paste Cursor **User API Key**.
2. Store in SuperOne credential vault (same pattern as other provider keys).
3. Pass per-call `apiKey` into `Agent.create` / `Cursor.models.list` (prefer not long-lived process env).
4. Optional: deep-link / copy CTA to `https://cursor.com/settings` Integrations.

**Pros:** supported, stable, matches SDK.  
**Cons:** extra setup vs “I already logged into Cursor.app”.

### B. Official-adjacent — env `CURSOR_API_KEY` for power users

Allow env fallback for CI/dev; still document User API Key as primary.

### C. UX bridge — open browser / CLI login helper (no secret scrape)

- Button: “Get User API Key” → settings page.
- Optional: detect `cursor-agent` installed and show “Run `cursor-agent login`” **only if** SuperOne later shells the agent CLI as a harness (different architecture than in-process SDK).

Does **not** auto-import desktop tokens.

### D. Unofficial — read desktop `cursorAuth` / Keychain (**not recommended to ship**)

Possible research spike only:

1. Read `cursorAuth/accessToken` from `state.vscdb` (or Keychain twin).
2. Call `Cursor.me({ apiKey: accessToken })` and/or skip exchange.
3. Observe 200 vs 401 vs exchange failure.

**Risks:**

- Breaks on Cursor updates / encryption / multi-profile.
- ToS / security: third-party app reading another app’s session store.
- Refresh/expiry handling belongs to Cursor, not SuperOne.
- May violate product expectation that Agent API is API-key gated.
- Electron sandbox / Keychain prompts UX pain.

**Gate:** do not put on product path without Cursor-written permission + legal OK.

### E. Architectural pivot — harness = `cursor-agent` CLI subprocess

If product priority is “use whatever the user already logged into on this machine”, evaluate **CLI subprocess** (login already solved by `agent login`) instead of / in addition to `@cursor/sdk`. That is a different design from the current SDK-first plan (event map, packaging, license all change).

---

## Implications for `cursor-sdk-harness.md`

**Locked in design doc (2026-07-25):** D1 native `@cursor/sdk`, **D2 User API Key auth** (this note).

| Topic | Status |
|---|---|
| Open Q1 (API key product model) | **Resolved:** user-supplied User API Key in SuperOne vault. |
| Auth UX | CONNECT_CURSOR = `Cursor.me` + `models.list`; Dashboard deep-link CTA. |
| Desktop login | **Non-goal** for v1. |
| `settingSources` | Orthogonal to login; still useful after key auth. |
| License | Separate PR2 Go/No-Go (redistribution ≠ auth). |

---

## Recommended product copy (honest)

> SuperOne talks to Cursor Agents through the official Cursor SDK, which requires a **User API Key**. Logging into the Cursor desktop app alone is not enough. Create a key under Cursor Settings → Integrations → User API Keys, then paste it into SuperOne.

Optional secondary:

> Advanced: set `CURSOR_API_KEY` in the environment for headless/dev use.

---

## Suggested follow-up probes (optional, offline)

1. With a real User API Key: confirm `Cursor.me` + local `Agent.create` + one `send`.
2. **Spike only:** try desktop accessToken as `apiKey` once; record status codes only (no logging of token). Ship nothing based on success without policy review.
3. Confirm Free plan limits (Background/Cloud agents may require paid; local may differ) — product matrix.

---

## Conclusion

| Question | Answer |
|---|---|
| Can auth use “user’s local Cursor” (desktop login) officially? | **No** |
| What does SuperOne need? | **Cursor User API Key** (vault / env) |
| Can we soft-detect desktop login for UX? | Yes — e.g. presence of `cursorAuth/cachedEmail` → “You’re logged into Cursor.app; still need a User API Key for SuperOne” (metadata only, no token use) |
| Should we scrape tokens? | **No** for v1 |

*Sources: `@cursor/sdk@1.0.24` types + bundled JS; local Cursor `state.vscdb` key inventory (values redacted); `cursor-agent --help` / about; community notes on User API Key vs Admin key for CLI.*
