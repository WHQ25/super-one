# Antigravity (ACP) integration

Minimum external CLI version: `agy >= 1.5.16` (`@agentclientprotocol/sdk` `^1.4.0`) ·
Last updated: 2026-11-27

## Upstream

- Protocol: [Agent Client Protocol](https://agentclientprotocol.com) through
  `@agentclientprotocol/sdk`.
- Runtime: External Antigravity CLI (`agy acp`), minimum version enforced via `EXTERNAL_CLI_MIN_VERSIONS['acp-antigravity'] = '1.5.16'`.

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
| `packages/shared/src/environment/external-cli-install.ts` | `EXTERNAL_CLI_MIN_VERSIONS['acp-antigravity'] = '1.5.16'` |
| `packages/acp/package.json` | `@agentclientprotocol/sdk` |
| `apps/desktop/package.json` | `@agentclientprotocol/sdk` |

## Documents

- [api-surface.md](api-surface.md) · [contracts.md](contracts.md) · [backlog.md](backlog.md)

## Version history

| Version | Date | Status | Upgrade doc | Commit |
|---|---|---|---|---|
| 1.3.0 | 2026-11-03 | executed | — | Initial Antigravity ACP harness integration |
| >= 1.5.16 | 2026-11-27 | executed | — | Enforced external CLI minimum version gate and retired legacy `< 1.5.15` transcript-wakeup workaround |
