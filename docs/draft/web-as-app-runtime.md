# Web-as-App Runtime (Draft)

Status: **draft** — product + architecture exploration, not an approved design  
Last updated: 2026-08-07  
Related: mini-app platform (`apps/desktop/CLAUDE.md` → Mini-App Platform), browser MCP tools, `packages/shared` miniapp bridge

---

## 1. Intent

SuperOne should stop treating “mini-app” and “web page” as two different product species.

**Target shape:**

> SuperOne is a **host capability bus** with a **trust system**.  
> Any renderable web surface can become an app by attaching the SuperOne client.  
> Agents operate a **real browser** and call **granted host capabilities** (fs, git, shell, tools, …).

This is intentionally closer to Capacitor / Electron-with-preload / “PWA + native bridge” than to “always sandboxed iframe package only.”

### Why now

Three product motivations drive the draft:

1. **Author & agent familiarity** — full browser stack (Vite/React/storage/DevTools/real network semantics) so agents and humans build with the same web model they already know.
2. **Host-side CLI power** — apps (and agents driving them) should be able to run selected local CLIs (e.g. `gh`) under explicit grants, not only pure web APIs.
3. **Blur the web ↔ app boundary** — ship SuperOne as an injectable client so existing sites/SPAs can become SuperOne apps without a mandatory pack-first workflow.

Security must stay sharp even when the UI boundary is soft:

- Soft: *what the user sees* (page vs app).
- Hard: *what the page is allowed to do* (capability grants).

---

## 2. Current State (baseline)

| Path | Container | Bridge | Notes |
|------|-----------|--------|--------|
| Production panel (`manifest.isDev` falsy) | Sandboxed `<iframe src="superone-app://…">` | Injected script + `postMessage` | Default often opaque origin (`allow-scripts` only); storage/media opt-in via sandbox attrs |
| Dev panel (`isDev: true`) | `<webview>` | `miniapp-preload` + `contextBridge` / IPC | Full guest Chromium; channel allowlists are a recurring footgun |
| Chat templates (standalone / intercept / result / popover) | Lightweight iframes in chat DOM | Subset of bridge | Short-lived, nested in host UI |
| Agent browser tools | Separate browser guest stack | `browser_*` MCP tools | Navigate/snapshot/actions — **page does not get `window.superone` by default** |
| Host APIs today | — | `superone.fs`, `git`, `kv`, `db`, `agent`, `ui`, `worker`, … | **No shell/exec** in author API |

Recurring engineering cost: **two panel transports** (iframe vs webview) must both be wired for every new message type. Logic is shared (`createSuperoneApi`); transport is not.

Packaged apps still matter (`.s1app`, integrity, install consent). This draft does not delete packaging — it **generalizes** what can sit behind the same bridge.

---

## 3. Decision Summary (proposed)

1. **Unify long-lived app surfaces on a real browser guest** (prefer `WebContentsView` / main-owned `webContents` long-term; webview tag is acceptable interim if it unblocks).
2. **Keep short-lived chat embeds as sandboxed iframes** (standalone tools, intercept HITL, result templates, widgets).
3. **Split the product into three layers:** Surface · Bridge · Capability.
4. **URL / origin is not the permission boundary.** Capability grants are.
5. **Shell is a host capability**, never “raw browser child_process.” Default off; bin allowlists; audit.
6. **Injection turns pages into apps only under an explicit trust ticket** — never high privilege by default for arbitrary internet origins.

---

## 4. Goals

- Authors use a normal web stack with predictable browser APIs.
- Dev and production panel runtimes share one transport story (no dual footgun).
- Agents can both **drive the UI** (browser automation) and **call structured tools** (MCP / `manifest.tools`).
- Selected local CLIs (e.g. `gh`) are available to granted apps.
- A web developer can attach SuperOne client code and turn a page into an app without learning a parallel UI framework.
- Users can open / enhance a page in SuperOne with progressive permission prompts.
- Crash isolation for untrusted or heavy app JS (guest process, not host renderer).

## 5. Non-goals (this draft)

- Replacing chat tool blocks / intercept templates with full browser guests.
- Giving every navigated website shell, fs, or project access by default.
- Free-form `sh -c` from untrusted content.
- Requiring every existing SaaS to rewrite as a SuperOne package before it is useful.
- Killing `.s1app` packaging in v1 of this direction.
- Making browser automation the only agent interface (declarative tools remain first-class).

---

## 6. Conceptual Model

```
┌─────────────────────────────────────────────────────────────┐
│ SuperOne Host                                               │
│                                                             │
│  Capability bus: fs · git · kv · db · shell · agent · ui …  │
│  Trust: grants, install consent, audit, revoke              │
│  Project / session context                                  │
│                                                             │
│     ▲ bridge protocol                    ▲ MCP tools        │
│     │                                    │                  │
│  ┌──┴──────────────────┐    ┌────────────┴──────────────┐   │
│  │ App Surface (guest) │    │ Agent browser + harness   │   │
│  │  local pack · URL · │    │  browser_* · app tools    │   │
│  │  SPA + superone.js  │    │                           │   │
│  └─────────────────────┘    └───────────────────────────┘   │
│                                                             │
│  Chat embeds: still sandboxed iframes (short-lived)         │
└─────────────────────────────────────────────────────────────┘
```

### 6.1 Surface

Anything that paints UI and runs page JS:

| Kind | Example | Lifetime |
|------|---------|----------|
| Packaged app | `superone-app://appId.projectId/…` from install dir | Long-lived panel |
| Dev source | Local folder via dev registry | Long-lived panel |
| Enhanced URL | `https://…` opened “in SuperOne” with optional inject | Long-lived tab/panel |
| Site opt-in SPA | App loads `@superone/client` and deep-links to host | Long-lived |
| Chat template | Intercept / standalone / result / popover HTML | Short-lived iframe |

### 6.2 Bridge

Transport-agnostic client already centered on `createSuperoneApi` (`packages/shared`).

- Page side: `window.superone.*` (protocol client only).
- Host side: validates grants, enforces scopes, executes privileged work.
- **Presence of the client ≠ presence of power.** Methods fail closed without a grant.

### 6.3 Capability

Host-approved powers, declared and/or interactively granted:

| Capability | Role |
|------------|------|
| `fs` | Project / app-scoped filesystem (existing model) |
| `git` | Repo introspection (existing) |
| `network` | CSP / fetch allow domains (existing for packs) |
| `storage` | Web storage / IDB (existing iframe opt-in) |
| `media` | mic/camera (existing) |
| `background` | worker host (existing) |
| **`shell` (new)** | Run allowlisted local binaries |
| `agent` | prompt / context (existing) |
| `tools` | MCP tool registration from manifest (existing) |

### 6.4 Soft UI boundary, hard trust boundary

User-facing language can blur “this is just a web page I’m using as an app.”

Implementation language must stay precise:

| Phrase | Meaning |
|--------|---------|
| “Open as SuperOne app” | Surface loads in guest + bridge attached + grant ticket created/updated |
| “Browse” | Guest without privileged bridge (or bridge with empty grant) |
| “Install / trust” | Persist identity + capability set (packaged or origin-bound) |

---

## 7. Trust & Grant Model

### 7.1 Trust classes (initial sketch)

| Class | How established | Default capabilities |
|-------|-----------------|----------------------|
| **Installed pack** | `.s1app` install + consent UI | Manifest-declared set after user approve |
| **Local dev** | Dev registry / pointer | Generous for author machine; still no unbounded shell without declare |
| **User-enhanced URL** | Explicit “Open & enhance” / per-session grant | Progressive; start minimal |
| **Site opt-in** | Site ships client + user connects host | Dual consent (site + user); OAuth-like mental model |
| **Casual browse** | Normal navigation | **None** (no privileged `superone` / or stub that only detects host) |

### 7.2 Grant ticket (sketch)

Logical fields (not final schema):

```ts
type CapabilityGrant = {
  grantId: string
  surface: {
    kind: 'pack' | 'dev' | 'url' | 'site-opt-in'
    appId?: string
    originPattern?: string // for url/site
    installDir?: string
  }
  projectId?: string // partition storage / fs context
  capabilities: {
    fs?: { scopes: Array<'project' | 'app' | …> }
    git?: boolean
    network?: { domains: string[] } // pack path; URL surfaces may use browser network
    storage?: boolean
    media?: Array<'microphone' | 'camera'>
    shell?: { bins: string[]; cwd: 'project' | 'app' | string }
    background?: boolean
    agent?: boolean
  }
  createdAt: number
  expiresAt?: number
  revocable: true
}
```

Rules:

- Every privileged bridge call checks the active grant for that surface instance.
- Grants are **revocable** from Settings.
- Storage/cookies partition by **surface instance × project** (continue origin or session-partition discipline).
- Navigation away from an allowed origin pattern **drops or re-prompts** elevated grants (policy TBD).

### 7.3 Failure modes to design against

1. **XSS on a granted origin** → treat as grant compromise; prefer bin allowlists + fs scopes over free shell strings.
2. **Confused deputy** — agent opens attacker page while a high grant is still bound to the guest → bind grants to surface identity, not “whatever is currently loaded.”
3. **Session × web login cross product** — page cookies + host shell/fs is powerful; isolate partitions; never share host profile carelessly.

---

## 8. Shell / CLI Capability

### 8.1 Why

Authors and agents often need tools that are already installed and authenticated on the machine (`gh`, project scripts, `bun`, etc.). Re-implementing every CLI as a SuperOne API is neither scalable nor faithful to local auth state.

### 8.2 Shape (sketch)

```ts
// Author-facing (illustrative)
superone.shell.run({
  bin: 'gh',                    // allowlisted name, not free shell
  args: ['pr', 'list', '--json', 'number,title'],
  cwd: 'project',               // or absolute under grant
  timeoutMs?: number,
  env?: Record<string, string>, // allowlisted keys only
}): Promise<{ code: number; stdout: string; stderr: string }>
```

### 8.3 Hard rules

| Rule | Rationale |
|------|-----------|
| Default **off** | Shell is RCE-adjacent |
| Manifest `permissions.shell` + install/first-use consent | Explicit user story |
| **Bin allowlist** (`gh`, `git`, `bun`, …) preferred over `sh -c` | Injection resistance |
| No shell metacharacter joining of args | Pass argv arrays only |
| cwd restricted to grant scopes | Contain blast radius |
| stdout/stderr size limits + timeout | Runaway processes |
| Audit log (app, bin, args summary, time, code) | Forensics / user trust |
| Not available to casual-browse surfaces | Default zero trust |

### 8.4 Prefer APIs when clean

Example: GitHub HTTP API + host-managed token may beat `gh` for many flows. Keep shell for:

- User already logged into CLI
- No stable API / wrapping cost too high
- Local toolchains (`bun test`, project scripts)

---

## 9. Injection: Turning a Web Page into an App

Three complementary entry paths (can ship in phases):

### 9.1 Host inject (user-driven)

User: “Open this URL in SuperOne and enhance.”

- Guest loads URL.
- Preload or controlled inject attaches SuperOne client.
- Grant starts minimal; capabilities requested on demand.

**Pros:** Works without site cooperation.  
**Cons:** Fragile against CSP; ethical/product care on third-party sites; login/cookie complexity.

### 9.2 Site / SPA opt-in (developer-driven)

Developer adds:

```html
<script type="module" src="https://…/superone-client.js"></script>
```

or npm `@superone/client`. Client detects host (custom protocol / handshake). Without host, app degrades to normal web.

**Pros:** Clean permissions, CSP cooperation, intentional product.  
**Cons:** Requires developer action.

### 9.3 Packaged / local (existing)

`.s1app` or dev folder remains the highest-trust, offline, integrity-checked path. Bridge injection stays host-controlled.

### 9.4 What “become an app” means product-wise

Minimum bar for “this page is a SuperOne app”:

1. Surface runs in SuperOne guest (or connected host session).
2. Bridge client is present and handshake succeeds.
3. At least one capability or tool registration is active under a grant.
4. Agent can discover tools and/or drive the surface.

Optional polish: dock tab chrome, icon, name, project binding, offline cache.

---

## 10. Container Strategy

### 10.1 Long-lived App Surface → real browser guest

**Why required for this vision (not optional polish):**

- Arbitrary `https://` origins cannot all be rewritten through `superone-app://`.
- Real sites need real cookies, storage, and frontend stacks.
- Host inject / preload only works cleanly on a guest boundary.
- Aligns agent `browser_*` world with app surfaces over time (shared guest primitives).

**Preference:**

| Horizon | Choice |
|---------|--------|
| Near term | Unify production **panel** path onto existing webview-class guest (match dev) |
| Medium term | Prefer Electron **`WebContentsView`** / main-owned webContents over permanent `<webview>` tag debt |

### 10.2 Short-lived embeds → keep iframes

Standalone tools, intercept, result templates, popovers, widgets stay sandboxed iframes:

- Nested in chat DOM
- Cheap mount/unmount
- Low privilege
- Auto-resize patterns already built

**Dual-path elimination goal is:** one transport for **panels / long-lived surfaces**, not “zero iframes in the product.”

### 10.3 Engineering win

Unifying panel transports removes the “add channel to preload + DevFrame + iframe bridge” footgun for the primary app surface.

---

## 11. Agent Model

Agents get two complementary levers:

| Lever | Use when |
|-------|----------|
| **Browser automation** (`browser_*`) | Visual/UI tasks, unfamiliar DOM, one-off flows |
| **Declarative tools** (`manifest.tools` / MCP) | Stable contracts, HITL intercept, structured I/O |
| **Host capabilities** (via app tools or future host tools) | fs/git/shell under grants |

Guidance for authors:

- Prefer tools for anything the agent must do reliably.
- Use full browser so the **human** stack is normal; do not force the agent to click through every workflow if a tool exists.

---

## 12. Phased Plan (proposal)

### Phase 0 — Align & inventory

- Document behavior diffs: prod iframe vs dev webview (storage, media, permissions, DevTools, channel list).
- List surfaces that must remain iframe (chat embeds).
- Draft grant schema + shell allowlist policy with security review notes.

### Phase 1 — Panel runtime = guest

- Production long-lived panels use browser guest.
- Shared transport for panel; keep chat iframes.
- DevTools/reload parity for production panels.
- No arbitrary URL enhancement yet if risk is high — still a large win for author stack + dual-path.

**Exit criteria:** New bridge API is wired once for panels; hello + one production app green on guest.

### Phase 2 — Grant tickets + bridge handshake

- Formalize grant attachment per surface instance.
- Fail closed without grant.
- Settings: list/revoke grants.
- Session/partition isolation review for multi-project.

**Exit criteria:** Capability check is centralized; install consent maps cleanly to grants.

### Phase 3 — Controlled shell

- `permissions.shell` + bin allowlist + audit.
- Available to **installed pack** and **local dev** first.
- Example bins: `gh`, `bun` (policy TBD).

**Exit criteria:** `gh pr list`-class flow works under grant; free shell string rejected; audit visible.

### Phase 4 — Web-as-app productization

- “Open URL in SuperOne” + optional enhance.
- `@superone/client` / inject protocol for opt-in sites.
- Progressive permission UI.
- Agent can attach tools to enhanced surfaces where declared.

**Exit criteria:** A third-party SPA (or demo site) becomes an app with two tools in ≤ developer-hour target; casual browse still zero privilege.

### Phase 5 — Guest platform consolidation (optional)

- Migrate tag webview → `WebContentsView` if still on tag.
- Share more primitives with browser tool guests where safe.

---

## 13. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Injection + shell = RCE | Grants, bin allowlist, no free shell, revoke, audit |
| Memory cost of many guests | Instance sharing rules (already partially exist), idle reclaim, limit concurrent enhanced URLs |
| Electron `<webview>` debt | Treat as interim; plan WebContentsView |
| CSP blocks inject | Prefer site opt-in; host inject best-effort with clear UX on failure |
| Agent over-relies on flaky DOM | Keep tools first-class; browser as complement |
| User confusion “is this a browser or an app?” | Clear chrome for grant state (trusted badge, permission chip) |
| Cookie + host power crossover | Partition per surface; never merge into desktop profile casually |

---

## 14. Success Metrics (draft)

- Author can scaffold or open an SPA with full DevTools and normal web storage without iframe sandbox footguns.
- One code path for panel bridge transport (dev ≡ prod panel).
- Granted app runs allowlisted CLI with audit entry.
- Web developer attaches client and exposes ≥1 agent tool without packaging (Phase 4).
- Zero privileged bridge access on casual navigation (security invariant tests).

---

## 15. Open Questions

1. **Primary Phase 4 entry path:** host-inject arbitrary URL vs site opt-in SDK first?
2. **Shell policy:** global bin allowlist vs per-app manifest list vs user-editable?
3. **Navigation policy:** if an enhanced tab navigates to another origin, auto-drop grant or re-prompt?
4. **Relationship to existing browser tabs:** same guest pool as `browser_*` or separate app-surface pool?
5. **Manifest for URL surfaces:** optional sidecar vs runtime-only tool registration?
6. **Remote node:** do shell grants execute on remote environments the same way? (likely yes later; out of scope for first desktop milestone)
7. **Integrity for inject:** pin client hash / only host-provided bridge script?

---

## 16. Recommendation (for discussion)

Ship the vision as **capability-centric web host**, not “replace every iframe with a browser.”

**Near-term yes:**

- Panel App Surface → real browser guest  
- Unify panel transport  
- Design grants before shell  

**Near-term no:**

- Unrestricted shell  
- Default inject + privilege on every URL  
- Moving chat templates off iframe  

**North star one-liner:**

> Soften the web/app UI boundary; harden the capability boundary; run long-lived surfaces in a real browser so SuperOne can inject a client and turn pages into apps under explicit trust.

---

## 17. Next Documents (when this draft is accepted)

- `docs/design/app-surface-runtime.md` — container + transport decision (normative)
- `docs/design/capability-grants.md` — grant schema, UX, revoke, audit
- `docs/design/shell-capability.md` — bin policy, IPC, threat model
- `docs/design/superone-client-inject.md` — client package, handshake, host inject limits

Until then, treat this file as **conversation-backed draft only**.
