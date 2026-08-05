# @superone/cli (workspace) / `@super-one/cli` (npm)

Headless SuperOne node: RPC server, workspaces, pairing, systemd install.

## Names

| Context | Name |
|---------|------|
| Monorepo workspace | `@superone/cli` |
| Public npm package | **`@super-one/cli`** |
| Global binary | **`superone`** |

```bash
# users (after npm publish)
npm install -g @super-one/cli@alpha   # or pin @0.49.x-alpha.N
superone start
superone install-systemd

# monorepo — daily remote-node development (host process, remote protocol)
bun run dev:cli:lab:smoke   # start local lab + pair token
bun run dev                # desktop; pairRemote to http://127.0.0.1:7789

# monorepo — Linux/SSH fidelity
bun run dev:cli:docker:smoke

# monorepo — publishable npm pack (no workspace:* deps)
bun run pack:cli                 # → apps/cli/dist/npm
bun run pack:cli -- --dry-run    # npm pack only
# CI: .github/workflows/publish-cli.yml (workflow_dispatch)
```

### Pack / publish (design §15)

| Item | Value |
|------|--------|
| Public name | `@super-one/cli` |
| Workspace name | `@superone/cli` (unchanged) |
| Version | Root `package.json` by default (lockstep with desktop) |
| Output | `apps/cli/dist/npm/` (`lib/cli.mjs` bundle + `package.json`) |
| Dist-tag | Derived from version: `-alpha*` → `alpha`, `-beta*` → `beta`, else `latest` |

- Local remote lab (host credentials, no Docker): [`docs/local-remote-lab.md`](./docs/local-remote-lab.md)
- Docker SSH lab: [`docker/README.md`](./docker/README.md)
- Design: `docs/design/remote-node-service.md` §15 (registry vs upload install)
