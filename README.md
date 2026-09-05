<div align="center">

<img src="docs/logo/text-inline.png" alt="SuperOne" width="420">

# Stop choosing a coding agent.

**SuperOne is the harness of harnesses.** Claude Code, Codex, Cursor, OpenCode,
DeepSeek and any ACP agent, in one desktop app, each running on its own engine,
each keeping what makes it great, and every one of them handed a browser, a
computer, a phone, a canvas, and each other.

[![version](https://img.shields.io/badge/version-0.61.0--alpha-blue)](CHANGELOG.md)
[![platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)](#install)
[![license](https://img.shields.io/badge/license-BUSL--1.1-orange)](LICENSE)

[Install](#install) · [The idea](#the-idea) · [What it feels like](#what-it-feels-like) · [Features](#everything-inside) · [Build](#build-from-source) · [简体中文](README.zh-CN.md)

</div>

---

## The idea

You have five coding agents installed. Each one is brilliant at something. Claude
plans and delegates. Codex has the best desktop app anyone has shipped. Cursor is
fast. OpenCode is open. DeepSeek is cheap and tireless.

And you can only use one at a time. Five terminals, five configs, five ideas of
what a "session" is, five permission dialogs that look nothing alike. None of them
can see a web page, tap a phone, or ask the agent in the next tab for help.

**SuperOne refuses to pick.** It does not wrap every agent in a beige lowest
common denominator. It runs each harness on its own runtime, with its own plan
mode, its own permission vocabulary, its own sandbox and subagents, and then
changes three things about the world around it:

<table>
<tr>
<td width="33%" valign="top">

### The Codex app, for everyone

Codex set the bar for what an agent desktop should feel like. SuperOne builds
that surface once and gives it to every harness that can carry it: plan review,
queued steering, real permission prompts, rewind, usage, compaction. Where a
harness genuinely can't, the button disappears instead of lying to you.

</td>
<td width="33%" valign="top">

### Superpowers, over MCP

SuperOne ships its own MCP server. The moment a harness connects, it can browse
the web, drive your Mac, control an iPhone simulator or an Android phone,
generate images and video, draw interactive widgets into the chat, and call
tools exposed by web pages. The harness authors never had to ship any of it.

</td>
<td width="33%" valign="top">

### Agents that hire each other

A Claude session spawns a Codex reviewer. Codex hands the boring migration to
DeepSeek. Cursor opens a mailbox with a session that's been running for an hour.
Across harnesses, with your approval, over durable Markdown, in isolated git
worktrees. Use the best model for each part of the job.

</td>
</tr>
</table>

> **Status: alpha.** SuperOne ships as two side-by-side apps, **SuperOne** and
> **SuperOne Alpha**, with separate data and update feeds. The alpha lane is the
> one published today. It moves fast. It has edges.

## What it feels like

**Ask Claude to plan it. Let Codex review it.** Plan mode opens with a line-by-line
review. Annotate the plan, send it back, approve. When the code lands, the agent
spawns a Codex session to review the diff and posts the findings back into your
chat. You never left the conversation.

**Drop a session onto the edge of the screen.** Mosaic tiles sessions side by side,
as many as the window can hold. Two agents on two worktrees of the same repo,
watching each other's progress. Maximize one, and the layout waits for you.

**Highlight anything. Ask in Side Chat.** Select text in the transcript, and a
forked conversation opens beside it with the full context and warm prompt cache.
Ask the dumb question. Explore the tangent. Close it, and the main thread never
knew.

**"Open the dashboard and tell me why the chart is wrong."** The agent opens a
real browser tab next to your chat, reads the accessibility tree, clicks through,
records the network traffic, profiles the page. If the site publishes WebMCP
tools, the agent can call them, once you've trusted that origin.

**"Run it on the phone."** The agent boots an iOS Simulator or picks up your
Android device, mirrors it into the dock, taps through the flow, and reads the
accessibility tree to confirm the bug. You can grab the screen and swipe yourself
at any moment.

**"Show me, don't tell me."** Instead of a paragraph, the agent renders a chart, a
diagram, a mockup, a tiny interactive tool, right in the chat. Save it as a
template and it becomes a widget the agent reuses with new data.

**Ship an app that the agent can call.** Write a mini-app with a Node host and a
WebView, drag it onto the sidebar, and its tools show up for every harness. The
agent can scaffold, pack and register mini-apps for you.

**Leave it running. Take the phone.** Sessions block on you, you get a
notification. Pick up your phone and answer from the SuperOne mobile app, over LAN
or through a relay you can self-host. Pair a server as a headless node and treat
it like a local project.

## Everything inside

### Six harnesses, one desk

| Harness | Package | Runs as |
|---|---|---|
| **Claude Code** | `@superone/claude` | Agent SDK, in process |
| **Codex** | `@superone/codex` | Codex app-server protocol; ChatGPT or API-key auth |
| **Cursor** | `@superone/cursor` | Cursor agent CLI |
| **OpenCode** | `@superone/opencode` | OpenCode server |
| **DeepSeek** | `@superone/deepseek` | In-process harness |
| **Others (ACP)** | `@superone/acp` | Any Agent Client Protocol agent; Grok recognized by name |

One project list. One session history. One provider and credential store. One set
of MCP servers, skills, hooks and plugins. Switching harness mid-project is a
dropdown. The whole app re-tints to the harness's brand when you do, and the hue is
yours to adjust.

Differences are declared as **data**, not branched at call sites
([`harness-capabilities.ts`](packages/shared/src/harness/harness-capabilities.ts)):

| | Claude | Codex | Cursor | OpenCode | DeepSeek | ACP |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| MCP servers | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Plan mode | ✅ | ✅ | ✅ | ✅ | | ✅ |
| Todos | ✅ | | ✅ | ✅ | ✅ | ✅ |
| Subagents | ✅ | | ✅ | ✅ | ✅ | |
| Compaction | ✅ | ✅ | | ✅ | ✅ | |
| Streaming tool input | ✅ | | ✅ | | | |
| Queued steer | ✅ | ✅ | | | | |
| Fork / Side Chat | ✅ | ✅ | | ✅ | ✅ | |
| Additional directories | ✅ | ✅ | | | | ✅ |

### The app-grade surface, shared

- **Plan mode** with real review: approve, or annotate line by line and send it back.
- **Permissions you can read.** A prompt that shows exactly what is being asked, a
  per-harness mode picker that keeps each harness's own vocabulary, a sandbox
  toggle where the harness has one.
- **Queue and steer.** Keep typing while the agent works. On Claude and Codex, a
  queued message can be promoted to a live steer mid-turn.
- **Todos, subagents, compaction, reasoning** rendered natively. Subagents get a
  collapsible tree with per-agent colors and a full-view drill-down.
- **Rewind** to any user message: code, conversation, or both, with a dry-run
  preview first.
- **Fork** a conversation in place or into a fresh worktree.
- **Model, effort, provider** selectors over a shared catalog, with fallback rows.
  Per-session context usage, plus an app-wide usage page with cost estimation
  across harnesses.
- **Scheduled sends** that survive restarts, so a rate-limit window is something
  you sleep through. **Automations** on cron.
- **Notifications** when a session blocks on you, withdrawn the moment it's
  answered anywhere.
- **Workflows**: multi-agent orchestration scripts rendered as a live DAG.

### The toolbox every harness inherits

SuperOne's built-in MCP server is attached to every session.

- **Browser use.** Tabs, navigation, accessibility snapshots, query, click, type,
  scroll, drag, upload, wait, evaluate, network recording, performance profiling,
  saved and replayable actions. DevTools-protocol features (cookies, mocking,
  emulation) are opt-in.
- **WebMCP.** Tools a page registers via `document.modelContext` become callable.
  Trust is per origin, for the session or forever. Every tool is fingerprinted by
  description and schema, so a page cannot swap an approved tool's behavior
  behind your back.
- **Computer use.** Enumerate apps, snapshot the accessibility outline, zoom into a
  region, click, type, wait for the screen to settle, through a separate signed
  helper. Grants are per app with a floating stop button. macOS today.
- **Device use.** iOS Simulator and Android, physical or emulator. Live mirror with
  picture-in-picture, your gestures, the agent's snapshots and actions. Control is
  granted by you, never assumed.
- **Widgets.** Interactive HTML rendered into the chat, saveable as templates, or
  targeting SuperOne's own native surfaces.
- **Mini-apps.** `.s1app` packages: a trusted Node host owns computation and agent
  tools, WebViews own rendering, SHA-256 verified on install.
- **Media.** Image and video generation through Google, OpenAI, OpenAI-compatible
  relays, ByteDance Ark and NewAPI. Results land in a turn-end gallery.
- **Sessions and settings.** Search and read past sessions; read or change
  SuperOne's own live configuration from inside a conversation.

### Collaboration, across harness lines

| Mode | What it does |
|---|---|
| `spawn` | A child you keep talking to. Fan out, or get a reviewer whose findings come back to you. |
| `handoff` | A sibling that takes over for good. Next phase, fresh context, unattended follow-up. |
| `link` | A mailbox with a session that already exists. Wake it, ask it, read back. |

Every launch needs your approval. Peers exchange structured Markdown, not scraped
transcript. Each peer can be pinned to its own model, effort, permission mode,
sandbox, working directory, or an isolated **git worktree**.

### A workspace, not a text box

- **Mosaic.** Tile sessions in a resizable split tree. Maximize, restore, close;
  the layout is remembered.
- **Side Chat.** An ephemeral fork docked beside the conversation. Full context,
  warm cache, zero footprint on the parent.
- **Worktrees as a first-class citizen.** Start a session in one, fork into one
  with or without your uncommitted changes, name its branch, hand the result back
  to the main checkout with a diff preview. Branch, HEAD and dirty state are
  always in the status bar.
- **Docked panels.** Editors and previews for code, Markdown, notebooks, images
  and PDFs; terminals; the browser; devices; mini-apps; Side Chat. Pin left or
  right, or maximize. A file tree with git coloring in the sidebar, a terminal
  drawer under the chat.
- **Code review.** Pick uncommitted changes, a branch or a commit and have the
  agent review it (Codex today).
- **Mini window.** Fold the app into a single-chat shell; the mosaic underneath is
  preserved.

### And the rest

Providers and keys, MCP server management with OAuth and elicitation, skills from
user, project and plugins, a plugin marketplace, hooks, English and 简体中文, light
and dark with per-harness brand hue, macOS vibrancy and Windows frosted glass,
remote control from your phone, headless server nodes, and auto-update per app
variant.

See [`CHANGELOG.md`](CHANGELOG.md) for what landed when.

## Install

Alpha builds, always the lane's newest version:

| Platform | Download |
|---|---|
| macOS (Apple Silicon) | [SuperOne-arm64.dmg](https://dl.super-one.dev/alpha/latest/SuperOne-arm64.dmg) |
| macOS (Intel) | [SuperOne.dmg](https://dl.super-one.dev/alpha/latest/SuperOne.dmg) |
| Windows | [SuperOne Setup.exe](https://dl.super-one.dev/alpha/latest/SuperOne%20Setup.exe) |
| Linux | [SuperOne.AppImage](https://dl.super-one.dev/alpha/latest/SuperOne.AppImage) |

The app auto-updates from `dl.super-one.dev`. SuperOne and SuperOne Alpha are
separate apps with separate data; install either or both.

Headless node:

```bash
npm install -g @super-one/cli@alpha
superone start
```

## Build from source

**Prerequisites:** [Bun](https://bun.sh) 1.3.9+ (this repo is a bun workspaces
monorepo; npm and pnpm are not supported) and Node.js 20+.

```bash
git clone https://github.com/WHQ25/super-one.git
cd super-one
bun install          # postinstall rebuilds native modules for Electron

bun run dev          # desktop app with hot reload
bun run typecheck    # type check every workspace
bun run test         # desktop test suite
```

Packaging:

```bash
bun run build:mac    # macOS DMG + ZIP
bun run build:win    # Windows NSIS installer
bun run build:linux  # Linux AppImage
```

Other entry points:

```bash
bun run dev:web      # Next.js site on :3000
bun run dev:cli      # headless node CLI
bun run dev:cli:lab  # local remote-node lab on :7789 (pair the desktop against it)
bun run dev:relay    # wrangler dev for the relay Worker
bun run storybook    # component workshop (packages/ui + desktop)
```

> The desktop suite is ~650 files and takes minutes. For day-to-day work, scope it:
> `bunx vitest run --changed HEAD` from `apps/desktop`.

## Repo layout

```
super-one/
├── apps/
│   ├── desktop/   @superone/desktop  — the Electron app (main / preload / renderer)
│   ├── cli/       @superone/cli      — headless node, published as @super-one/cli
│   ├── web/       @superone/web      — Next.js marketing / docs / demos site
│   ├── relay/     @superone/relay    — Cloudflare Workers + Durable Objects relay
│   └── video/     @superone/video    — Remotion compositions, offline render
└── packages/
    ├── shared/          neutral types, harness capabilities & brand, i18n, mini-app runtime
    ├── ui/              shadcn primitives + OKLch theme, shared by desktop & web
    ├── runtime/         session / fs / git / lease / spawn-env / crypto
    ├── claude, codex, cursor, deepseek, opencode, acp/   harness packages (opt-in)
    ├── desktop-mocks/   fixtures for Storybook and tests
    ├── video-compositions/
    └── tsconfig/        shared base configs
```

Cross-package imports go through package names (`@superone/shared/agent-types`,
`@superone/ui/components/ui/button`) resolved by each package's `exports` map. There
is no build step between packages; Vite and TypeScript read the source directly.

## Documentation

| Where | What |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Monorepo layout, cross-package resolution, repo-wide conventions |
| [`apps/desktop/CLAUDE.md`](apps/desktop/CLAUDE.md) | Electron architecture, IPC, stores, remote control, devices, mini-apps, testing, release |
| [`apps/cli/CLAUDE.md`](apps/cli/CLAUDE.md) | Headless node RPC, workspaces, pairing, local lab |
| [`AGENTS.md`](AGENTS.md) | Commit message guideline (also the human one) |
| [`docs/design/`](docs/design) | Design notes for harnesses, remote nodes, permissions |
| In-app | `read_manual` — product, mini-app, media and widget manuals the agent reads |

The `CLAUDE.md` files are written for coding agents, but they are the most accurate
architecture docs in the repo. Read them.

## Contributing

Commits follow `<type>(<scope>): <subject>`: imperative, lowercase, English, ≤72
chars, one logical change per commit. The full guideline, including when a body is
required and what belongs in it, is in [`AGENTS.md`](AGENTS.md).

Before opening a PR: `bun run typecheck` and a scoped test run
(`bunx vitest run --changed HEAD` from `apps/desktop`).

## License

[Business Source License 1.1](LICENSE): source-available, not OSI open source.

You may copy, modify and redistribute the work, and use it in production for
personal, educational or other non-commercial purposes. Production use for a
commercial purpose requires a separate license from the Licensor. Two years after
publication each version converts to Apache 2.0.
