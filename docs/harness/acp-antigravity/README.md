# Antigravity (ACP) integration

Pin: `agy-acp-server` `1.3.0` (`@agentclientprotocol/sdk` `^1.4.0`) · Ledger version: 1.3.0 ·
Last updated: 2026-11-03

## Upstream

- Protocol: [Agent Client Protocol](https://agentclientprotocol.com) through
  `@agentclientprotocol/sdk`.
- Runtime: Google Antigravity ACP server (`agy_acp_server.par` / `agy_acp_server.exe` + sibling `localharness_external` / `localharness_external.exe`), managed download from `https://dl.google.com/agy-extensions/releases/agy-acp-server/v1.3.0/v1.3.0-<platform>-<arch>.zip`.

## Integration shape

| Runtime | Entry | Notes |
|---|---|---|
| Desktop sessions | `apps/desktop/src/main/session/backends/acp-backend.ts` | Shared ACP session backend with `acpAgentId: 'antigravity'` |
| Desktop ACP runtime | `apps/desktop/src/main/acp/acp-runtime.ts`, `apps/desktop/src/main/acp/antigravity-runtime-bridge.ts`, `apps/desktop/src/main/acp/antigravity-protocol.ts` | Handles JSON-RPC filtering, models, effort config options, auth methods, and `agent_ask_user` permissions |
| Profile & auth | `apps/desktop/src/main/acp/antigravity-profile.ts`, `apps/desktop/src/main/acp/antigravity-auth-service.ts` | Isolated `GEMINI_HOME` profile, 4 auth methods, browser OAuth interception |
| Runtime delivery | `packages/runtime/src/harness/antigravity-release.ts`, `packages/runtime/src/harness/antigravity-runtime.ts`, `packages/runtime/src/harness/antigravity-zip.ts` | SHA-256 verified ZIP download and extraction |
| Usage quota probe | `apps/desktop/src/main/acp/antigravity-usage.ts` | Cloud Code PA `retrieveUserQuotaSummary` quota windows |

## Pin locations

| Location | What |
|---|---|
| `packages/runtime/src/harness/antigravity-release.ts` | `ANTIGRAVITY_RELEASE_VERSION = '1.3.0'` and platform SHA-256 manifest |
| `packages/acp/package.json` | `@agentclientprotocol/sdk` |
| `apps/desktop/package.json` | `@agentclientprotocol/sdk` |

## Documents

- [api-surface.md](api-surface.md) · [contracts.md](contracts.md) · [backlog.md](backlog.md)

## Version history

| Version | Date | Status | Upgrade doc | Commit |
|---|---|---|---|---|
| 1.3.0 | 2026-11-03 | executed | — | Initial Antigravity ACP harness integration |
