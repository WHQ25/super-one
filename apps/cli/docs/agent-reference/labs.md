# CLI lab verification

Use a lab already selected for the task. Local labs reuse host credentials; Docker
labs are useful for Linux/SSH fidelity. A lab is a real remote-protocol node, not IPC.

### Manual test: desktop ↔ local lab (UI)

Use this when verifying remote protocol / harness / session work without Docker.

```bash
# Terminal A — host-process node (loopback :7789, home ~/.superone/dev/node-dev-lab)
bun run dev:cli:lab

# Terminal B — Electron (dev build only shows the Local lab card)
bun run dev
```

1. In the app: **Remote Control → Control Other Devices**.
2. Open the **Local lab** card (dashed border, top of the channel list).
3. Status should show **Lab online** and `http://127.0.0.1:7789`.
   - If **Lab offline**: lab is not running → start Terminal A, then hit refresh.
4. Click **Connect lab** (or **Reconnect lab** if already paired).
5. Expect a success toast; the paired row appears under the card (connect / disconnect / remove).
6. Open a remote project on that environment and exercise chat/terminal as needed.
7. **Files tab:** list + git decorations + **preview/edit** (`readProjectFile` /
   `saveFile` / `git.diff` over RPC); rename, drag-move, delete; drag
   **local→remote** (copy) and **remote→local**. Per-file cap **10 MiB**.
   Restart lab after CLI workspace changes: `bun run dev:cli:lab:restart`.

**What the button does:** `GET /health` → if not already paired for that baseUrl, mint a
pairing token via monorepo `pair-create` against `SUPERONE_NODE_HOME` →
`pairRemote` / `connect` (IPC: `environment:localLabStatus`, `environment:pairLocalLab`).

**DevTools fallback** (optional):

```js
await window.environment.pairLocalLab()
// or: await window.environment.localLabStatus()
```

After changing `apps/cli/src/**`, restart the lab (`bun run dev:cli:lab:restart`) before
re-testing — the running process does not hot-reload.

Package-local: `bun run dev` / `bun run test` / `bun run build:dist` / `bun run pack:npm` from `apps/cli/`.

**npm publish (`@super-one/cli`):** `scripts/pack-npm.ts` esbuild-bundles monorepo sources into
`dist/npm/` (no `workspace:*`). CI: `.github/workflows/publish-cli.yml` (`workflow_dispatch`).
Root: `bun run pack:cli` / `bun run publish:cli`. Version defaults to monorepo root `package.json`
(lockstep with desktop). Dist-tag from version (`-alpha*` → `alpha`). Requires `NPM_TOKEN` or
npm Trusted Publishing for real publish.


## Reloading code

Local and Docker labs do not hot-reload imported CLI/runtime packages. Restart
the task's lab before retesting changed runtime behavior:

```bash
bun run dev:cli:lab:restart
# For the Docker lab selected for this task:
docker restart superone-remote-cli
docker inspect --format='{{.State.Health.Status}}' superone-remote-cli
```

A restart can interrupt active sessions or SSH forwarding; preserve unrelated
work and re-establish forwarding/reconnect when needed. Do not restart a lab just
because it might exist. Upload-installed binaries need `build:dist` and re-upload;
a restart alone cannot install changed source.

See [local-remote-lab.md](../local-remote-lab.md) and
[Docker README](../../docker/README.md) for setup and troubleshooting.
