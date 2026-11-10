# Grok (ACP) API surface

Ledger version: `@agentclientprotocol/sdk` 1.4.0, model discovery/control only.
The rest of the surface has not been inventoried.

## Models

| Name | Status | Usage | Code |
|---|---|---|---|
| `session/new` | used | Desktop and node read the initial `configOptions` and legacy `models` catalog. Node cold discovery opens a disposable session without a prompt or MCP servers. | `apps/desktop/src/main/acp/acp-runtime.ts`, `packages/acp/src/run-turn.ts`, `packages/acp/src/model-catalog.ts` |
| `session/set_config_option` | used | Apply a chosen model using the model select's advertised config id before node prompt handoff; desktop also applies live changes and effort. Errors are propagated. | `packages/acp/src/run-turn.ts`, `apps/desktop/src/main/acp/acp-runtime.ts` |
| `session/set_model` | used | Legacy fallback when the catalog has no config id. The synthetic `default` choice leaves the agent's default intact. | `packages/acp/src/run-turn.ts`, `apps/desktop/src/main/acp/acp-runtime.ts` |
| `config_option_update` | used | Standard session update refreshes model and mode catalogs. | `packages/acp/src/agent-event-mapper.ts`, `apps/desktop/src/main/acp/acp-event-map.ts` |
| `_x.ai/models/update` | used | Also accept the bare `x.ai/models/update` notification. Node translates it into `acp_models`; cold discovery can use it when the new-session response has no catalog. | `packages/acp/src/xai-event-map.ts`, `packages/acp/src/model-catalog.ts`, `apps/desktop/src/main/session/backends/acp-backend.ts` |

## Prompt suggestion

| Name | Status | Usage | Code |
|---|---|---|---|
| `_x.ai/suggestPrompt` | used | Client-pull after a successful grok-build idle turn. Desktop fire-and-forgets; node awaits before dispose. Maps `suggestion` onto shared `prompt_suggestion`. Method-not-found and timeout are silent. | `packages/shared/src/grok-suggest-prompt.ts`, `apps/desktop/src/main/acp/acp-runtime.ts`, `packages/acp/src/run-turn.ts` |
| `x.ai/follow_ups` | used | Agent-push chips, still mapped when they arrive. Generic ACP (`clientIdentifier: superone`) is not known to emit this. | `packages/acp/src/xai-event-map.ts`, `apps/desktop/src/main/acp/acp-xai-session-notify.ts` |
