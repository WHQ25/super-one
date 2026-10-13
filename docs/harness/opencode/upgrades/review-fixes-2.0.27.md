# OpenCode V2 review fixes

Status: executed · Client: `@opencode/client` 2.0.27 · Date: 2026-10-13

## Scope

Fix the four findings from the completion review without changing the SDK pin,
V1 behavior, or unrelated worktree changes. This is a follow-up to
[completion](completion-2.0.27.md); that executed record remains unchanged.

## Changes

- [DONE] Node Stop reaches the managed runner's native interruption port when
  an adopted inbox execution has no ordinary kernel turn/abort.
- [DONE] Native terminal facts settle a turn with a pending HTTP receipt. Desktop,
  managed node and per-turn V2 adapters share the settlement helper. Each adapter
  cancels its scoped transport and keeps a late rejection handler; no input is
  resent. Native acceptance releases the original input admission gate for Steer.
- [DONE] MCP OAuth carries a per-request captured proof from Session through the
  backend, shared runtime and native attempt. Discovery, browser launch, polling,
  attempt completion and MCP connection cannot adopt a newer caller's authority.
- [DONE] Mobile cold catalog updates preserve an opened OpenCode session's
  credential-scoped models. Session/harness changes release that catalog.
- [DONE] Affected regression/type/build checks and real native inbox Stop.

## Verification

The new unit/hook regressions failed before the fixes. The native inbox Stop
failure was also reproduced through authenticated node RPC with a local model
fixture; the native executor continued despite the interrupted host state.

Focused desktop runtime/lease/OAuth tests, node runtime/queue/history contracts,
mobile selection tests and seven native RPC cases passed after the changes.
The focused desktop run passed 102 cases across nine files, the shared OpenCode
run passed 18, and the mobile hook run passed 32. Runtime/queue and LAN/relay
contract checks also passed; repeated files are not counted as additional coverage.
Typechecks passed for desktop main, mobile, CLI, shared runtime and OpenCode.
Desktop main production bundling and OpenCode ESM bundle/import checks passed.
The native suite covers inbox Stop/adoption, service-crash recovery, Steer,
credential rotation, OAuth, fork/rewind and node restart. Fixtures use isolated
directories and local HTTP models/MCP, with no real model account.

No full-suite, installed-app or physical-phone acceptance is claimed. The
complete CLI package retains the previously recorded unrelated Cursor SDK
bundling blocker; OpenCode's ESM adapter is checked independently.
