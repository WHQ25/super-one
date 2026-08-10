# Tool UI: rendering a tool in chat

## Contents

- [Philosophy](#philosophy)
- [Decide first: what must the user see?](#decide-first)
- [The base template](#the-base-template)
- [Label copy and casing (collab grammar)](#label-copy-and-casing-collab-grammar)
- [Result-as-UI (no header)](#result-as-ui-no-header)
- [Summary is the product](#summary-is-the-product)
- [Progressive disclosure](#progressive-disclosure)
- [Where the routing lives](#where-the-routing-lives)
- [Writing a custom block](#writing-a-custom-block)
- [The four states](#the-four-states)
- [allowExpand: the nested-in-a-subagent case](#allowexpand)
- [Hiding a tool is a contract](#hiding-a-tool-is-a-contract)
- [i18n](#i18n)
- [Storybook first](#storybook-first)
- [Mobile stripping](#mobile-stripping)
- [Debugging a tool row](#debugging-a-tool-row)

## Philosophy

Tool UI is for **humans watching the agent work**, not for dumping the tool schema into the
transcript. Every SuperOne tool that appears in chat should have an intentional presentation: the
user must be able to tell, at a glance, **what just happened**.

Two principles drive every decision:

1. **Observability** — the transcript is a live log of agent actions. If a tool ran and the user
   cannot tell what it did, the UI failed — even if the model got a perfect result.
2. **Progressive disclosure** — show the smallest surface that still tells the story. For most
   tools that is a collapsed header with a one-line summary; detail lives behind expand. For a few
   tools the **result itself** *is* the story (see [Result-as-UI](#result-as-ui-no-header)) — then
   a header would only add noise. Do not put raw args, full JSON, or machine ids in a header just
   because they exist.

The **generic MCP row** (plug icon + server · tool name + raw expandable result) is a **fallback**
for third-party / unhandled tools. It is *not* the design target for SuperOne built-ins. Shipping a
new `mcp__superone__*` tool without a designed row means the user only sees plumbing.

## Decide first

Before writing a component, answer: **what does the user need to know about this call?**

| Question | Guides |
|---|---|
| What is the *human* story of this call in one short phrase? | The **summary** (and often the label verb) |
| Do the args matter to a human at all, or does the **result alone** fully represent the call? | Header row vs [result-as-UI](#result-as-ui-no-header) |
| What is noise if shown collapsed (paths, UUIDs, full prompts, raw JSON)? | Stays out of the header; optional expand body |
| Is the result something the user must scan (hits, diff, settings delta)? | Expand body or a richer custom block |
| Is the tool pure agent-internal meta with no conversational value? | **Hidden** (only with a display owner if output matters) |
| Does another surface already show the output (e.g. turn-end image gallery)? | **Hidden** via the hide contract |

Then pick the lightest implementation that delivers that story:

| Outcome | When | Cost |
|---|---|---|
| **Designed row** (required for SuperOne tools) | Default for any user-visible SuperOne tool | Compact header and/or small block |
| **`CompactToolRow` only** | One line is the whole story: `Read manual: product/debug`, `Packed: my-app-1.0.s1app` | ~15 lines in `ToolBlock.tsx` |
| **Custom `<Feature>ToolBlock`** (header + expand) | Structured result needs scan/expand (search hits, collab peers, config diff, media progress) | component + stories + i18n |
| **Result-as-UI (no header)** | Args are irrelevant to the user; the rendered result *is* the tool call — e.g. `widget_show` → `WidgetBlock` | content component; nested fallback row |
| **Hidden** | Agent-internal meta, *or* another surface owns the output | hide predicates — see contract below |
| **Generic fallback** | Unhandled third-party MCP / unknown tool | zero — do not plan for this for SuperOne built-ins |

Bias: **designed for the user first**, then implement with the smallest UI that keeps the call
readable. A custom block is justified by *user comprehension*, not by tool importance. Dumping
every parameter into the header is not "more observable" — it is less. Skipping the header is only
correct when the body already answers "what happened" with no need for tool chrome.

## The base template

Almost every tool row in this app follows the same chrome. Copy it; do not invent a new layout.
(Exception: [result-as-UI](#result-as-ui-no-header) tools that intentionally omit the header.)

```
┌─────────────────────────────────────────────────────────────┐
│ [icon]  Tool name / verb    summary (truncated)    [chevron] │  ← collapsed header
├─────────────────────────────────────────────────────────────┤
│  optional expanded body (result, fields, diff, pretty JSON) │  ← progressive detail
└─────────────────────────────────────────────────────────────┘
```

| Slot | Role | Rules |
|---|---|---|
| **Icon** | Glanceable category | `ToolIcon` closed union, or app/MCP icon when branded. Error/denied swap to status icons. |
| **Label** | What kind of action | Follow [collab grammar](#label-copy-and-casing-collab-grammar). Streaming vs done are different i18n keys. `font-medium text-foreground`, `shrink-0`. |
| **Summary** | What *this* call did | Muted fragment: entity, count, query quote — not Title Case chrome. See summary rules below. |
| **Expand indicator** | Affordance that more exists | `ChevronRight`, `ml-auto`, rotates when open. Only if there is expand body *and* `allowExpand`. |
| **Chrome** | Shared shell | `tool-node my-0.5 rounded bg-muted/20`, header `flex … gap-1.5 px-2 py-1.5 text-xs`. Expand uses `grid-template-rows` 0fr→1fr transition. |

Reference implementations of this template:

- **Canonical label grammar:** `SessionCollabToolBlock` in `ToolBlock.tsx` + `chat.toolBlock.collab.*`
- Same chrome: `AppToolBlock`, `ConfigApplyBlock`, media/browser blocks, session archive
  (`SessionArchiveToolBlock` + `chat.toolBlock.archive.*`)
- Default fallback path at the bottom of `ToolBlock.tsx` (icon + displayName + summary + chevron)

`CompactToolRow` is the non-expandable header-only form of the same template (icon + children, no
chevron). Use it when there is truly nothing to expand.

## Label copy and casing (collab grammar)

**Do not invent a new voice for each tool family.** New SuperOne tool rows copy the agent
collaboration tools (`session_collab_*` → `SessionCollabToolBlock` / `chat.toolBlock.collab`).
Session archive (`session_list` / `search` / `read` / `cleanup` → `chat.toolBlock.archive`) was
aligned to the same grammar — use either family as the reference when reviewing Storybook.

### English (EN)

| Slot / state | Casing | Examples (collab) | Examples (archive) |
|---|---|---|---|
| **Streaming label** | Sentence case; trailing `…` when in progress | `Requesting collaboration…`, `Starting session`, `Sending message to`, `Retrieving messages` | `Listing sessions…`, `Searching sessions…`, `Reading user messages…`, `Confirming delete…` |
| **Done primary label** | **Title Case** (each major word capital) | `Collaboration Requested`, `Session Started`, `Message Sent`, `Messages Retrieved` | `Sessions Listed`, `Session Meta`, `User Messages`, `Cleanup Preview`, `Sessions Deleted` |
| **Count / empty as label** | Sentence-style fragment (not full Title Case slogans) | `Received {{count}} messages`, `No messages` | `Found {{count}} hits`, `No hits` |
| **Failure / cancel label** | Title Case short outcome | (often shared settings strings) `Settings change rejected` is sentence-ish legacy — prefer Title Case for new: `List Failed`, `Delete Cancelled` | `List Failed`, `Search Failed`, `Read Failed`, `Delete Cancelled`, `Delete Rejected` |
| **Summary (muted)** | Sentence / lowercase fragments, **not** Title Case chrome | peer title `DiffBot - Reviewer`, `{{count}} agents`, `reused` | `{{count}} sessions`, `“auth refresh”`, session title, `before 2026-07-01` |
| **Expand field labels** | Title Case short nouns | `Name`, `Model`, `Session`, `From` | `Title`, `Harness`, `Messages`, `Session` |

Put the ellipsis **in the i18n string** for streaming keys (e.g. `Listing sessions…`). Do not
append a second `…` in React when the string already ends with one (collab only adds a runtime `…`
when the label does not already end with `.` / `…`).

### Chinese (ZH)

Match collab’s concise progressive / completed pairing, not a literal EN Title Case:

| State | Pattern | Examples |
|---|---|---|
| Streaming | `正在…` + optional `…` | `正在请求协作…`, `正在列出 Session…` |
| Done | `已…` or short noun phrase | `已请求协作`, `Session 已启动`, `已列出 Session`, `清理预览` |

Keep product nouns stable where collab does (`Session`, `Agent`, harness names).

### What the summary slot is for

- **Label** = verb / outcome type (the tool family’s action).
- **Summary** = *which* instance (title, peer, count, query) — human locators only.
- Never put in either slot when collab would not: raw `confirmToken`, full absolute `projectPath`,
  long UUID lists, multi-line task body (task body goes in expand or confirm UI).

### i18n key shape

Mirror collab’s streaming/done pair under a family namespace:

```
chat.toolBlock.collab.requestingCollaboration   // streaming
chat.toolBlock.collab.collaborationRequested    // done
chat.toolBlock.archive.listingSessions          // streaming
chat.toolBlock.archive.sessionsListed           // done
chat.toolBlock.archive.sessionCount             // summary fragment "{{count}} sessions"
chat.toolBlock.archive.fields.title             // expand field label
```

Prefer a nested object per tool family (`collab`, `archive`, `browser`, …) over a flat soup of keys
when the family has more than a handful of strings. Both `en.ts` and `zh.ts` must define every key.

### Anti-patterns (copy)

| Smell | Why | Instead |
|---|---|---|
| Sentence-case done labels only (`Listed sessions`, `Read conversation`) | Diverges from collab Title Case done chrome | `Sessions Listed`, `Conversation` |
| Title Case streaming (`Listing Sessions…`) | Feels static / complete while still running | Sentence case + `…` |
| Title Case in the muted summary (`4 Sessions · Auth`) | Competes with the label; noisy | `4 sessions`, `“auth”` |
| Hardcoded English in the component | Breaks ZH UI; drifts from collab | `t('chat.toolBlock…')` only |
| New family invents its own voice | Transcript looks like mixed products | Diff Storybook against `AgentCollaboration/ToolUI` |

## Result-as-UI (no header)

Some tools are not "an action log line with optional detail" — they **are** content dropped into the
transcript. For those, a tool header (`icon + name + summary + chevron`) would only narrate what the
user can already see.

Canonical example: **`widget_show`** → `WidgetBlock` in `ToolBlock.tsx`.

| Condition | Why it fits |
|---|---|
| **Parameters do not matter to the user** | The args are generative payload for the UI, not a story the user needs to audit ("called widget_show with …") |
| **The result fully represents the call** | Seeing the widget *is* understanding what the agent did; no extra label improves observability |
| **Not the same as Hidden** | The tool stays in the transcript as visible content. Hidden removes the row because *another* surface owns display (gallery). Result-as-UI *is* the surface |

Wiring pattern (`widget_show`):

1. Prefer rendering the content component from parsed result (or partial input while streaming).
2. **No** base-template header when `allowExpand` and data is available — just `<WidgetBlock … />`.
3. **Nested subagent** (`allowExpand === false`): do **not** mount the full content UI; fall back to a
   one-line `CompactToolRow` (verb + optional title). Full interactive/content blocks do not fit
   inside a subagent card.
4. If data is not parseable yet: temporary Compact row ("Generating widget…") until content can show.

Do **not** use this pattern when:

- the user still needs to know *which* file / session / domain was touched (header summary carries that);
- the result is opaque JSON the user will not read as primary content;
- you are only trying to "look cleaner" — use a short summary header instead.

Related but different: **image generation** hides the tool row and shows files in the turn-end
gallery (`isHiddenToolBlock`). That is hide + other owner, not result-as-UI.

## Summary is the product

This codebase is built around **summaries**: a short string so the user can see what the tool call
did without reading args or result JSON.

Sources (prefer in this order when wiring a row):

1. **UI-derived summary from parsed input/result** — e.g. file basename, `domain/topic`, pack
   filename, launch name. `getToolDisplay(...).summary` for native tools; SuperOne branches build
   their own string from the fields that matter to a human.
2. **`toolSummary` on the content block** — precomputed by main/ACP (`computeToolMeta`,
   `displayToolSummary`, harness titles). Agent-facing titles and Bash `description` land here.
   `ToolBlock` falls back to `toolSummary` when `display.summary` is empty.
3. **Explicit agent fields** — collab launches require a short `summary`; mini-app tools can declare
   `inputSummaryField` / `resultSummaryField`. Prefer a dedicated short field over stuffing the
   full task into the header.

What belongs in a summary:

| Good | Bad |
|---|---|
| `src/main.ts` | full absolute path + line ranges + encoding |
| `product / collaboration` | entire guide markdown |
| `Review the failing tests` (collab) | full multi-paragraph task body |
| `my-app-1.0.0.s1app` | both `appDir` and `outputDir` JSON |
| first ~80 chars of a prompt, truncated | whole generation prompt + every option |

Streaming: summary may be partial (params still arriving). Type-guard every field; half-parsed JSON
is normal. Prefer showing a growing human fragment over waiting for a perfect parse.

## Progressive disclosure

| Layer | Content |
|---|---|
| **Collapsed (always)** | Icon + name/verb + **one** summary that answers "what did this call do?" |
| **Expanded (on demand)** | Structured detail the user may want: result body, key/value fields, diff, pretty JSON, error text |
| **Result-as-UI** | No header layer — the content component *is* the disclosure surface (see above) |
| **Never in the header** | UUIDs, full paths when a basename works, raw tool args objects, multi-line task text, model-facing error stacks (unless the whole tool *is* an error state) |

Expand rules in `ToolBlock`:

- Expand only when there is something worth showing (`hasResult`, diff, QA, or your block's own
  detail rows) **and** `allowExpand !== false`.
- Default expand for file diffs follows user settings; do not auto-expand huge JSON dumps for
  SuperOne tools unless product clearly needs it.
- Nested subagent cards force `allowExpand === false` → header-only (see below).

## Where the routing lives

`apps/desktop/src/renderer/src/components/chat/ToolBlock.tsx` — inside
`if (mcpInfo?.serverName === SUPERONE_SERVER) { … }`, a chain of `if (mcpInfo.mcpToolName === '…')`
branches. Order matters only where prefixes overlap (browser/computer matched by helper predicates
first).

Supporting pieces:

| Concern | File |
|---|---|
| Icon + summary for native (non-MCP) tools | `tool-display.ts` → `getToolDisplay` |
| Human label, verb, MCP name parsing | `tool-display.ts` → `formatToolLabel` / `getToolLabel`, `getToolVerb`, `parseMcpToolName` |
| Hidden-block predicates | `tool-display.ts` → `isAlwaysHiddenToolBlock`, `isHiddenToolBlock` |
| Header-only row primitive | `CompactToolRow`, local to `ToolBlock.tsx` |
| Icon set | `ToolIcon.tsx` (`ToolIcon` type is a closed union in `tool-display.ts`) |
| Precomputed summary on the wire | `toolSummary` on tool_use blocks; filled by `computeToolMeta` / ACP mappers |

`getToolDisplay` short-circuits for anything starting with `mcp__` and returns `{ icon: 'plug',
summary: '' }`. That is deliberate: MCP tools get icon and summary from their **branch** in
`ToolBlock.tsx`, not from the shared native table. Do not add SuperOne MCP tool names to
`getToolDisplay`.

A simple designed SuperOne row (header only):

```tsx
if (mcpInfo.mcpToolName === 'note_pin') {
  const noteId = typeof params.noteId === 'string' ? params.noteId : ''
  return (
    <CompactToolRow icon={<ToolIcon icon="clipboard-list" className="size-3 shrink-0 text-muted-foreground" />}>
      <span className="font-medium text-foreground">
        {isStreaming ? <>{t('chat.toolBlock.pinningNote')}…</> : t('chat.toolBlock.pinnedNote')}
        {noteId && <>: <span className="text-muted-foreground">{noteId}</span></>}
      </span>
    </CompactToolRow>
  )
}
```

Note `params` — already parsed input; during streaming it is the *partial* input preview. Guard
every field with a type check.

When the tool needs expand, follow the base template (same file as collab / `AppToolBlock` /
default MCP row): header click toggles `expanded`, chevron rotates, body in the grid transition,
detail content only mounts or becomes visible when expanded.

## Writing a custom block

Own file, `apps/desktop/src/renderer/src/components/chat/<Feature>ToolBlock.tsx`. Props follow the
house shape:

```tsx
export interface NoteToolBlockProps {
  toolName: NoteToolName            // narrow union, not string
  params: Record<string, unknown>   // parsed (possibly partial) tool input
  result?: string | null            // raw result text; null while streaming
  isStreaming?: boolean
  isError?: boolean
  isDenied?: boolean
  allowExpand?: boolean             // false when nested under a subagent card
}
```

Still **start from the base template**, unless the tool is explicitly [result-as-UI](#result-as-ui-no-header)
(content component only). Custom usually means custom *summary derivation* and custom *expand body*,
not a new visual language.

Parsing the result is the block's job, and it must be **total**: the result may be JSON, TOON,
markdown, an error string, or truncated. Prefer small `tryParseJson` / `tryParseToon` / `asRecord`
helpers that return `null` instead of throwing, then degrade to raw text when nothing parses. A
block that throws takes the whole message down.

Visual language: compact header row (icon + label + summary + chevron) with optional expand panel.
Follow `apps/desktop/CLAUDE.md` for tokens — `IconButton` for icon buttons, semantic colors stay
semantic.

## The four states

Every branch and every block handles all four. Skipping one is the most common review finding.

| State | Signal | What the user must see |
|---|---|---|
| Streaming | `isStreaming` | collab-grammar streaming label + whatever **summary** fragment has arrived |
| Complete | else | collab-grammar done label (Title Case EN) + final summary (+ expand if detail exists) |
| Error | `isError` | failure label + error text in summary or expand — never a blank row |
| Denied | `isDenied` (result starts with `[denied] `) | stable family label + `Denied` (or feedback) in summary — collab keeps identity, does not invent a new verb |

`ToolBlock` strips the `[denied] ` prefix into `cleanResult` before your branch runs, so read
`isDenied` rather than sniffing the string again.

## allowExpand

When a tool row is nested inside a subagent card, `ToolBlock` runs with `allowExpand === false` and
the row must collapse to a single line. Every block that can appear inside a subagent needs the
degradation branch:

```tsx
if (!allowExpand) {
  return (
    <CompactToolRow icon={<ToolIcon icon="image" className="size-3 shrink-0 text-muted-foreground" />}>
      <span className="font-medium text-foreground">{t('chat.toolBlock.generatedVideo')}</span>
      {/* optional short summary still welcome */}
    </CompactToolRow>
  )
}
return <VideoGenToolBlock … />
```

`media_generate_video`, `media_list_providers`, and the collab tools all do this — copy the closest.

## Hiding a tool is a contract

Two predicates in `tool-display.ts`:

- `isAlwaysHiddenToolBlock` — agent-internal meta with no conversational value:
  `TodoWrite`, `TaskCreate`, `TaskUpdate`, `session_rename`, `session_list_agents`,
  `session_collab_list_agents`, `miniapp_list`. Session archive (`session_list` / `search` / `read` /
  `cleanup`) is **not** hidden — `SessionArchiveToolBlock` owns those rows. Also consumed by
  `groupContent`, so hiding here keeps surrounding thinking blocks adjacent instead of leaving a gap.
- `isHiddenToolBlock(toolName, result)` — **result-dependent** hiding. This is where the contract
  lives: `media_generate_image` is hidden *because the turn-end image gallery renders the file*, and
  `media_video_status` is hidden while running or on success but **kept on failure** so the error is
  visible.

The rule that keeps this from losing output: **hide only when another surface owns the display, and
make both sides read the same predicate.** The gallery's "which blocks do I own" check and
`isHiddenToolBlock` must not drift, or the result vanishes from the transcript entirely.

Never hide a tool merely because its row is noisy — a short **summary** on a designed row is the
answer to noise. Hide is for "no user value" or "owned elsewhere", not for "I didn't design a UI".

## i18n

All copy goes through `useTranslation()` with keys under `chat.toolBlock.*`, defined in **both**
`packages/shared/src/i18n/{en,zh}.ts` (types live on the EN `toolBlock` interface). A missing `zh`
key silently falls back to English in the Chinese UI — ships unnoticed.

Rules:

1. **No hardcoded user-facing English** in the block (Storybook fixtures may still use English data).
2. **Streaming / done pair** for every primary label — see [collab grammar](#label-copy-and-casing-collab-grammar).
3. **Family namespace** when the tool set is multi-tool: `chat.toolBlock.collab.*`,
   `chat.toolBlock.archive.*`, `chat.toolBlock.browser.*`.
4. **Summary / count fragments** are separate keys (`agentCount`, `sessionCount`, `hitsFound`) so
   pluralization and word order can differ by locale without string concat hacks.
5. **Expand field labels** under `fields.*` (Title Case short nouns in EN).

Reference: collab keys in `packages/shared/src/i18n/en.ts` → `toolBlock.collab`; archive keys →
`toolBlock.archive`.

## Storybook first

Write `<Feature>ToolBlock.stories.tsx` (or stories through `ToolBlock` for Compact branches)
alongside the component with realistic fixtures covering, at minimum: streaming, complete-with-data,
complete-empty, error, denied, and the `allowExpand: false` variant. Fixtures should be **real
captured tool output**, not invented JSON — invented fixtures make the parser look more robust than
it is.

For in-progress designs, keep the block unwired from `ToolBlock` until Storybook review (same
workflow as archive-style blocks). Stories are cheap; a bad block discovered in a live session is
not.

```bash
bun run storybook
```

## Mobile stripping

`stripContentBlock` in `apps/desktop/src/main/remote-control-service.ts` prepares events for the phone:

- `tool_use.input` is set to `''` — except for an explicit allowlist (`widget_show`,
  `mobile_share_file`).
- `tool_result.summary` is truncated to `TOOL_RESULT_MAX_LEN` unless the tool is an agent/task.
- `toolSummary` is preserved via `computeToolMeta` when possible — phone rows still need a short
  human summary even when input is stripped.

If a tool's phone rendering needs its **input** or full result, add it to that allowlist. If you
don't, the desktop row looks right and the phone row is blank — a class of bug that only shows up
when someone opens the app on their phone.

## Debugging a tool row

```bash
RENDERER_VITE_DEBUG_TOOL_NAMES=note_pin,media_generate_video bun run dev
```

Dev-only, case-insensitive partial match. Matching tools render raw prettified input/output instead of
their normal UI, which answers "is the block wrong or is the result wrong" in one step. `DebugToolBlock`
takes priority over every other branch, including hiding.
