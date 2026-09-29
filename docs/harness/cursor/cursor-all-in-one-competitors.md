# Research: Do all-in-one desktop agent clients integrate Cursor?

| Field | Value |
|---|---|
| **Status** | Research note |
| **Date** | 2026-07-25 |
| **Context** | SuperOne Cursor harness decision |
| **SDK public beta** | 2026-04-29 (`@cursor/sdk`) |

## Short answer

**Yes — a few multi-agent / all-in-one clients already integrate Cursor, but depth varies a lot.**

| Integration depth | Examples | Pattern |
|---|---|---|
| **Deep: `@cursor/sdk` in-process / worker** | **Helmor**, OpenProse, Mastra, pi-cursor-sdk | Closest to SuperOne’s planned path |
| **Medium: Cursor CLI / process orchestration** | **Paseo** (marketing), various orchestrators | Spawn `cursor-agent` or drive local Cursor |
| **Protocol: ACP agent profile** | OpenAgents (planned), JetBrains + Cursor ACP | Host talks ACP, not necessarily SDK |
| **Session aggregation only** | Codeg (reads `~/.cursor/chats`) | History browser, not full harness |
| **Not found as first-class** | Most Claude+Codex-only desktops | Cursor left out or “coming soon” |

Closest SuperOne analogue with **shipped Cursor SDK**: **[Helmor](https://github.com/dohooo/helmor)** (Tauri multi-agent workbench).

---

## Landscape (SuperOne-like products)

### 1. Helmor — **yes, first-class `@cursor/sdk`**

- **What:** Local-first multi-agent workbench (Tauri). Parallel agents, worktrees, diffs, PR, mobile companion.
- **Agents:** Claude Code, Codex, **Cursor**, OpenCode, Kimi Code.
- **Cursor how:**
  - `@cursor/sdk` in a **separate Node worker** (not Bun — HTTP/2 tool traffic breaks under Bun).
  - Class A npm SDK; version pinned; staged as vendor/sidecar deps.
  - No `settingSources` in one path (project MCP injected manually — see their `project-mcp.ts` comments).
  - Event pipeline in Rust (`pipeline/accumulator/cursor.rs`) for `status` / `tool_call` / `assistant` / `thinking`.
  - Node `>=22.13` floor; phantom `@connectrpc/connect-node` packaging notes (pre-1.0.21).
- **Why it matters for SuperOne:** Best open reference for Electron/Tauri packaging + dual-runtime (Node worker) decisions; validates “Cursor as peer harness next to Claude/Codex/OpenCode.”
- **Forum:** Helmor author confirmed SDK use + `bun build --compile` sidecar + sqlite3 native-addon pain (same class of issues SuperOne design already flagged).

### 2. Paseo — **yes (product surface), likely CLI / process**

- **What:** Desktop + mobile + daemon orchestration; multi-provider agents. Large visibility (~11k★ repo).
- **Marketing:** Lists Cursor among agents (“Send tasks to Cursor on your machine… Cursor CLI”).
- **GitHub README emphasis:** Claude Code, Codex, Copilot, OpenCode, Pi — Cursor more prominent on marketing `/agents` than core README bullets.
- **How (inferred):** “Each agent runs as its own process using its own CLI or local integration” + ACP catalog for many agents → **not the same as deep in-process SDK**, more like SuperOne ACP lane + CLI spawn.
- **Why it matters:** Shows market demand for “drive Cursor from one control plane” without necessarily embedding full SDK.

### 3. OpenProse — **yes, `@cursor/sdk` harness (CLI, not desktop IDE)**

- Multi-agent Markdown programs through coding-agent SDKs.
- Cursor harness via PR #64; praise for local-mode + `settingSources`.
- Not a SuperOne-class desktop shell, but validates multi-harness SDK composition.

### 4. Mastra — **yes, SDK meta-harness (framework)**

- “Agent meta-harness”: run Claude Code, Cursor, and Codex as SDK subagents inside Mastra.
- Framework / server oriented, not an all-in-one Electron chat product — but shows Cursor joining the same “multi-SDK agent” category as Claude & Codex.

### 5. pi-cursor-sdk — **yes, extension**

- Pi coding agent provider extension over `@cursor/sdk@1.0.23`, local-default, optional cloud.
- Agent-runtime plugin, not a full multi-pane desktop app.

### 6. OpenAgents Desktop — **planned Cursor lane (ACP-first)**

- Epic: multi-agent parity with T3 Code — Codex, Claude Code, Grok, **Cursor** interchangeable per thread.
- Cursor path described via **ACP peer profile** substrate, not explicitly `@cursor/sdk` as the primary plan in the epic text.
- Codex already first-class; Cursor “protocol client landing / no desktop lane yet” (as of epic wording).

### 7. Codeg — **Cursor as aggregated session source**

- Multi-agent workspace; lists Cursor among many agents.
- Documents Cursor chat paths (`~/.cursor/chats`) for aggregation — stronger on **session import** than owning Cursor’s agent loop.

### 8. Lumi / smaller OSS desktops — **claim Cursor, early**

- Lumi: “Claude / Crush / GeminiCLI / HERMES / CURSOR” in README; small star count; depth unclear.
- Many other “Claude + Codex desktop” apps **do not** list Cursor.

### 9. JetBrains IDEs — **Cursor via ACP (not all-in-one competitor)**

- Cursor available as ACP agent inside JetBrains IDEs.
- Relevant as **host pattern**: third-party UI drives Cursor agent protocol without forking Cursor IDE.

### 10. Sandcastle — **cursor-sdk provider (planned)**

- Issue/PRD: built-in `cursor-sdk` agent provider running `@cursor/sdk` in sandbox.
- Orchestration platform, not SuperOne twin.

---

## Patterns (how “Cursor” gets integrated)

```text
A. @cursor/sdk worker/process   → Helmor, OpenProse, Mastra, pi-cursor-sdk
B. cursor-agent / Cursor CLI    → Paseo-style “drive on machine”
C. ACP stdio agent              → JetBrains, OpenAgents plan, Kimi-like peers
D. Chat history import only     → Codeg-style aggregation
```

SuperOne’s design doc sits in **A**, with optional **C** if wrapping Cursor as ACP agent later (Helmor/OpenProse chose A for fidelity).

---

## Competitive implication for SuperOne

| Observation | Implication |
|---|---|
| Cursor SDK is ~3 months public beta; multi-harness desktops are **early but real** | SuperOne is not inventing the category; Helmor already ships A |
| Helmor’s packaging lessons match our gates (Node floor, natives, worker isolation, no Bun HTTP/2) | Steal engineering patterns; license/redistribution still SuperOne’s legal gate |
| Many peers use CLI/ACP for breadth, SDK for depth | SuperOne can ship MVP via SDK (parity with Helmor) or ACP if Cursor ACP agent is stable |
| Auth still API-key / own login in all cases | Confirms prior auth research: no magic “share desktop login” in peer products |
| All-in-one market often lists Claude + Codex first; Cursor is the **newer third pillar** | Product differentiation: quality of Cursor stream/permission honesty vs checkbox support |

---

## Recommendation

**Locked in `cursor-sdk-harness.md` (2026-07-25):** SuperOne ships **native `@cursor/sdk`** (D1) + User API Key auth (D2) — same class as Helmor/OpenProse, not CLI-only.

1. Treat **Helmor** as primary competitor teardown for packaging & event map (Node worker if main regresses, vendor stage, stream mapping).
2. Treat **Paseo** as UX/market competitor for multi-device orchestration; don’t assume CLI depth = SDK.
3. Optionally later: ACP path if Cursor publishes a stable ACP binary (JetBrains-style).

---

## Sources

- Helmor README + internal `vendors.md` (via GitHub API): Claude/Codex/Cursor/OpenCode/Kimi classes
- Cursor forum SDK beta thread (OpenProse PR #64, Helmor sidecar note)
- Paseo marketing agents page + GitHub README
- Mastra blog: Claude / Cursor / Codex SDK agents
- OpenAgents epic #8898 multi-agent parity
- Codeg README agent path table
- JetBrains ACP Cursor announcement (secondary)

*Not a full product audit of every binary; integration depth for Paseo/Lumi/Codeg is inferred from public docs/marketing and may change.*
