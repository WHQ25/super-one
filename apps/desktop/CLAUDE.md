# Desktop guidance

Electron main/preload/renderer app. Root `CLAUDE.md` owns package conventions,
test scope, commit rules, and UI story coverage.

## Read for the task

| Change | Reference |
|---|---|
| IPC, stores, environment routing, session ownership, SQLite | [architecture.md](docs/agent-reference/architecture.md) |
| Build identity, installers, updater, versioning | [packaging.md](docs/agent-reference/packaging.md) |
| Theme, sidebar, icons, z-index, editor DOM | [styling.md](docs/agent-reference/styling.md) |
| Logs, event trace, raw tool debugging | [debugging.md](docs/agent-reference/debugging.md) |
| Test runner, integration fixtures, component tests | [testing.md](docs/agent-reference/testing.md) |
| Simulator/Android platform integration | [devices.md](docs/agent-reference/devices.md) |
| Mini-app Host, WebView, bridge APIs, packaging | [miniapps.md](docs/agent-reference/miniapps.md) |
| New dependencies, feature entry points, startup work, bundle size | [performance.md](docs/agent-reference/performance.md) |

## Boundaries

- Keep Electron APIs in main/preload; use the existing IPC and environment gateway
  for renderer operations. `window.environment` is preferred where the capability
  has migrated; do not add a second permanent local/remote implementation.
- Session control and subscriber ownership belong to `Session`, not transport or
  scattered IPC guards. Shared contracts live in `@superone/shared`.
- Database changes preserve old-client compatibility. Read the migration section
  of architecture before editing migrations; destructive schema changes require
  the documented staged compatibility process.
- Mini-app computation and tools run in the Node Host. WebViews render and exchange
  structured messages; they have no Node integration. New chat windows need the
  documented WebView guards before displaying mini-app content.
- Build identity comes from `variants.json`, not version-string inference.
- UI uses shared primitives, semantic tokens, and the `z-layers.ts` ladder.
  Follow scoped styling guidance when changing those surfaces.
- Keep the startup path lean. Heavy or optional libraries and SDKs load at the
  use site behind a lazy boundary, and nothing new blocks `createWindow`. When
  adding a dependency or a feature entry point, verify that the entry chunk and
  main bundle do not pick it up statically.

For a harness integration or an agent-tool change, use the matching repository
skill. Ordinary work inside a backend does not require an all-harness audit.
Verify the affected behavior and integration paths; use the root scoped-test rule.
