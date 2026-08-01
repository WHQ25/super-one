# @superone/cli (workspace) / `@super-one/cli` (npm)

Headless SuperOne node: RPC server, workspaces, pairing, systemd install.

## Names

| Context | Name |
|---------|------|
| Monorepo workspace | `@superone/cli` |
| Public npm package | **`@super-one/cli`** |
| Global binary | **`superone`** |

```bash
# users
npm install -g @super-one/cli
superone start

# monorepo — daily remote-node development (host process, remote protocol)
bun run dev:cli:lab:smoke   # start local lab + pair token
bun run dev                # desktop; pairRemote to http://127.0.0.1:7789

# monorepo — Linux/SSH fidelity
bun run dev:cli:docker:smoke
```

- Local remote lab (host credentials, no Docker): [`docs/local-remote-lab.md`](./docs/local-remote-lab.md)
- Docker SSH lab: [`docker/README.md`](./docker/README.md)
- Design: `docs/design/remote-node-service.md` §15 (registry vs upload install)
