# Docker SSH remote node lab (scheme B)

> **Daily harness / credential work?** Prefer the **local remote lab** on the host
> (`bun run dev:cli:lab:smoke`) — same remote RPC protocol, host `$HOME` logins
> (Claude/Codex/Grok), no re-auth in a container. See
> [`docs/local-remote-lab.md`](../docs/local-remote-lab.md).
>
> Use **this Docker lab** for Linux + SSH forward + clean-host install fidelity.

Simulates a **remote Linux** host for `superone`:

| Surface | Binding |
|--------|---------|
| SSH | published `host:2222 → container:22` |
| Node HTTP/WS | **only** `127.0.0.1:7788` inside the container |

The desktop (or curl on the Mac) must use **SSH local port forward**, matching the design default (SSH bootstrap / loopback node).

```text
[Desktop / curl]
   http://127.0.0.1:7788
        │  ssh -L 7788:127.0.0.1:7788
        ▼
[Docker Linux]
   sshd :22
   superone → 127.0.0.1:7788   ← not published
```

## Prerequisites

- Docker Desktop
- Repo on branch with `apps/cli` (e.g. `feat/remote-node-service`)
- OpenSSH client (`ssh`, `ssh-keygen`)

`up` generates a **lab-only** keypair under `apps/cli/docker/lab-keys/` (gitignored
private key) and mounts the public key into the container. Password auth remains
enabled as fallback (`superone` / `superone`) but scripts use the lab key.

Host `node_modules` is **not** reused: compose mounts a Linux-only Docker volume
at `/work/node_modules` so macOS native addons are not overwritten.

## Quick start

From monorepo root:

```bash
# build + start + wait healthy + pair + health via SSH -L
bun run dev:cli:docker:smoke
# or
./scripts/remote-cli-docker.sh smoke
```

## Daily loop

```bash
# terminal 1 — keep forward open
bun run dev:cli:docker:forward

# terminal 2 — mint pairing token
bun run dev:cli:docker:pair

# terminal 3 — desktop on the feature branch
bun run dev
```

DevTools on the desktop:

```js
await window.environment.pairRemote({
  baseUrl: 'http://127.0.0.1:7788',
  pairingToken: '<from pair>',
  label: 'docker-ssh-linux',
})
```

## Commands

| Command / npm script | Purpose |
|----------------------|---------|
| `up` / `dev:cli:docker` | Keys + build/start + wait healthy |
| `down` / `dev:cli:docker:down` | Stop container |
| `logs` | Tail logs |
| `status` | Docker status + in-container `/health` |
| `ssh` | Shell into container |
| `pair` / `dev:cli:docker:pair` | `pair-create` |
| `forward` / `dev:cli:docker:forward` | Blocking SSH `-L` |
| `health` | Ephemeral forward + `curl /health` |
| `smoke` / `dev:cli:docker:smoke` | Full smoke |

Manual SSH (same as `forward`):

```bash
ssh -p 2222 -i apps/cli/docker/lab-keys/id_ed25519 \
  -L 7788:127.0.0.1:7788 superone@127.0.0.1
```

## Runtime note

`better-sqlite3` triggers a Bun NAPI crash (`NAPI FATAL ERROR: Error::New`) on
**both Linux and macOS** — the CLI must not be launched with `bun run`. The
container therefore:

- uses **Bun** only for `bun install`
- runs the CLI with **Node 22 + tsx**

The same applies on the host: `bun run dev:cli` / `bun run --filter @superone/cli pair`
shell out to `tsx`, not `bun run src/cli.ts`.

## What this validates

- Node runs on **Linux** with native `better-sqlite3` (via Node, not Bun)
- Node is **not** published to the host network (only SSH is)
- Access path is **SSH local forward** → container loopback
- Identity persists in the `superone-home` volume across restarts
- Pairing token + desktop `pairRemote` against forwarded loopback

## Not covered here

- Real Claude/Codex harnesses (production fail-closed without `simulatedHarness`)
- Tailscale / Relay
- Full Settings UI (use DevTools `pairRemote` until UI is wired)

## Tear down

```bash
bun run dev:cli:docker:down
# optional: wipe identity + linux node_modules volumes
docker volume rm superone-remote-cli_superone-home \
  superone-remote-cli_remote-cli-modules \
  superone-remote-cli_remote-cli-bun-cache
```
