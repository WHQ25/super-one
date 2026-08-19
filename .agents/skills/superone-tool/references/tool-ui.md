# Tool UI: rendering a tool in chat

## Contents

- [Philosophy](#philosophy)
- [Decide first: what must the user see?](#decide-first)
- [The base template](#the-base-template)
- [Label copy and casing](#label-copy-and-casing-collab-grammar)
- [Error and denied chrome](#error-and-denied-chrome)
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
| **`CompactLabeledToolRow` only** | One line is the whole story: `Manual Read` + `product/debug`, `Mini-app Packed` + `foo.s1app` | a few lines in `ToolBlock.tsx` |
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
┌──────────────────────────────────────────────────────────────────────┐
│ [icon]  Label    summary (truncated)    [Denied|Error]    [chevron] │  ← collapsed header
├──────────────────────────────────────────────────────────────────────┤
│  optional expanded body (result, fields, diff, error text, JSON)    │  ← progressive detail
└──────────────────────────────────────────────────────────────────────┘
```

| Slot | Role | Rules |
|---|---|---|
| **Icon** | Glanceable category | `ToolIcon` closed union, or app/MCP icon when branded. Denied/error swap via `ToolStatusIcon`. |
| **Label** | What kind of action | Follow [label grammar](#label-copy-and-casing-collab-grammar). Three i18n keys (streaming / action / done). Render with `ToolName` so running text shimmers. |
| **Summary** | What *this* call did | Separate muted span (`ToolSummary`). Space-separated — **never a colon** after the label. Entity, count, query quote — not Title Case chrome. |
| **Status badge** | Outcome when interrupted | `ToolStatusBadge`: Denied (red) or Error (warning). Only when denied/error. |
| **Expand indicator** | Affordance that more exists | `ChevronRight`, `ml-auto`, rotates when open. Only if there is expand body *and* `allowExpand`. |
| **Chrome** | Shared shell | `toolRowSurfaceClass(tone)` — default `bg-muted/20`; denied `denied bg-error/10`; error `errored bg-warning/10`. Expand uses `grid-template-rows` 0fr→1fr. |

Shared primitives live in `tool-row.tsx` — **use them**, do not re-hand-roll the header:

| Primitive | Use |
|---|---|
| `ToolName` | Label + `animate-shimmer` while streaming (not when denied) |
| `ToolSummary` | Muted truncated summary |
| `CompactLabeledToolRow` | Non-expandable header (icon + label + summary + badge) |
| `ExpandableToolRow` | Header + chevron + body (archive / automation / failed media) |
| `toolOutcomeLabel` | Pick streaming / action / done string |
| `ToolStatusIcon` / `ToolStatusBadge` / `toolRowSurfaceClass` | Denied / error chrome matching Bash / Read / Browser |

Reference rows: `SessionArchiveToolBlock`, `AutomationToolBlock`, SuperOne compact branches in
`ToolBlock.tsx`, `VideoGenToolBlock`. Collab still owns its peer-title header but uses the same
`ToolName` + surface + badge. Storybook catalog: `SuperOne/MCP Tools`.

## Label copy and casing

**Do not invent a new voice for each tool family.** SuperOne rows share one three-way grammar.
Pick strings with `toolOutcomeLabel({ streaming, interrupted, streamingLabel, actionLabel, doneLabel })`.
Canonical catalog: Storybook `SuperOne/MCP Tools`.

The badge already says Denied / Error. **Do not also put Failed / Denied / Rejected in the title.**

### English (EN)

| Slot / state | Form | Examples |
|---|---|---|
| **Streaming** | Sentence case verb-ing + `…` | `Generating image…`, `Listing sessions…`, `Tagging session…`, `Updating settings…` |
| **Done (success)** | Title Case **noun + past participle** | `Image Generated`, `Sessions Listed`, `Session Tagged`, `Settings Updated`, `Mini-app Registered` |
| **Denied / error** | Title Case **verb + noun** (the action) | `Generate Image`, `List Sessions`, `Tag Session`, `Update Settings`, `Register Mini-app` |
| **Count / empty as label** | Sentence fragment, success-only | `{{count}} Messages Retrieved`, `No messages`, `Found {{count}} hits` |
| **Summary (muted)** | Sentence / lowercase fragments | prompt, `{{count}} sessions`, `“auth refresh”`, peer title — **space**, never `Label: summary` |
| **Expand field labels** | Title Case short nouns | `Name`, `Model`, `Session`, `From` |

| State | Image | Video | Session list | Tag | Config apply |
|---|---|---|---|---|---|
| Streaming | Generating image… | Generating video… | Listing sessions… | Tagging session… | Updating settings… |
| Done | Image Generated | Video Generated | Sessions Listed | Session Tagged | Settings Updated |
| Denied / error | Generate Image | Generate Video | List Sessions | Tag Session | Update Settings |

Running labels shimmer (`ToolName` + `animate-shimmer`). Denied does **not** shimmer.

Put the ellipsis **in the i18n string** for streaming keys, or use `withStreamingEllipsis`. Do not
double `…`. Browser / Computer Use / Bash stay action-verb names (`Navigate`, `Click`, `Bash`) —
they are a different family.

### Chinese (ZH)

Write **Chinese**, not English product nouns mixed into the phrase.

| State | Pattern | Examples |
|---|---|---|
| Streaming | `正在…` + optional `…` | `正在生成图片…`, `正在列出会话…` |
| Done | 名词 + `已` + 动词 | `图片已生成`, `已列出会话`, `小程序已注册`, `消息已发送` |
| Denied / error | 动词 + 名词 | `生成图片`, `列出会话`, `打标签`, `更新设置` |

Do **not** leave `Session` / `Agent` / `Widget` / `Harness` in ZH tool-row copy (`列出 Session` is wrong → `列出会话`). Settings pages may still use those English product names; chat tool rows do not.

### What the summary slot is for

- **Label** = the action (running / done / interrupted form above).
- **Summary** = *which* instance (title, peer, count, query, prompt) — human locators only.
- Never: raw `confirmToken`, full absolute `projectPath`, UUID lists, multi-line task body
  (those go in expand or the confirm UI).

### i18n key shape

Three primary keys per action, plus summary / field fragments:

```
chat.toolBlock.generatingImage     // streaming
chat.toolBlock.generateImage       // denied / error (verb + noun)
chat.toolBlock.generatedImage      // done (noun + past participle)
chat.toolBlock.archive.listingSessions
chat.toolBlock.archive.listSessions
chat.toolBlock.archive.sessionsListed
chat.toolBlock.archive.sessionCount   // summary "{{count}} sessions"
chat.toolBlock.archive.fields.title
```

Prefer a nested object per family (`collab`, `archive`, `automation`, `browser`) when the set is
larger than a handful. Both `en.ts` and `zh.ts` must define every key.

### Anti-patterns (copy)

| Smell | Why | Instead |
|---|---|---|
| Success past tense on a failed/denied row (`Image Generated` + Error) | Claims the work finished | `Generate Image` + Error badge |
| Failed baked into the title (`Image Generation Failed`, `Video Status Failed`) | Duplicates the Error badge | `Generate Image` / `Check Video Status` + Error |
| Colon between name and summary (`Read manual: widget/overview`) | Breaks the name + space + muted summary template | `Manual Read` + `widget/overview` |
| Sentence-case done labels only (`Listed sessions`) | Diverges from Title Case done chrome | `Sessions Listed` |
| Title Case streaming (`Listing Sessions…`) | Feels complete while running | Sentence case + `…` + shimmer |
| Title Case in the muted summary (`4 Sessions · Auth`) | Competes with the label | `4 sessions`, `“auth”` |
| Hardcoded English in the component | Breaks ZH; drifts | `t('chat.toolBlock…')` only |
| ZH tool-row copy mixed with EN nouns (`列出 Session`) | Looks unfinished | `列出会话`, `智能体`, `组件` |
| New family invents its own voice | Transcript looks like mixed products | Diff `SuperOne/MCP Tools` |

## Error and denied chrome

Same chrome as Bash / Read / Browser. Do not invent a grey row that writes “Denied” into the
summary or recolors the label with `text-destructive`.

| State | Icon | Surface | Badge | Title |
|---|---|---|---|---|
| Denied / rejected / cancelled | red Ban | `denied bg-error/10` | `Denied` | verb + noun |
| Error | warning TriangleAlert | `errored bg-warning/10` | `Error` | verb + noun |

`ToolStatusIcon` + `ToolStatusBadge` + `toolRowSurfaceClass(tone)` implement this. Pass
`tone={toolRowTone(isDenied, isError)}` into `CompactLabeledToolRow` / `ExpandableToolRow`.

Failed **generation** rows (`media_generate_image`, `media_generate_video`) must be **expandable**
and show the host error string in the body (`mediaToolErrorMessage`). Success image rows stay
hidden (gallery owns them); a failed image/video row is the only place the user can read why.

`isDenied` is true when the raw result starts with `[denied] `. `ToolBlock` strips that prefix
into `cleanResult` — read the flag, do not re-parse the string. Confirm decline / cancel is
`status: 'rejected' | 'cancelled'` → **denied** tone, not error.

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
| Header-only / expandable row primitives | `tool-row.tsx` → `CompactLabeledToolRow`, `ExpandableToolRow`, `ToolName` |
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
    <CompactLabeledToolRow
      icon={<ToolIcon icon="clipboard-list" className="size-3 shrink-0 text-muted-foreground" />}
      label={withStreamingEllipsis(
        toolOutcomeLabel({
          streaming: isStreaming,
          interrupted: isDenied || !!isError,
          streamingLabel: t('chat.toolBlock.pinningNote'),
          actionLabel: t('chat.toolBlock.pinNote'),
          doneLabel: t('chat.toolBlock.notePinned'),
        }),
        isStreaming,
      )}
      streaming={isStreaming}
      tone={toolRowTone(isDenied, isError)}
      summary={noteId || undefined}
    />
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
| Streaming | `isStreaming` | verb-ing label + shimmer + whatever **summary** fragment has arrived |
| Complete | else | noun + past participle + final summary (+ expand if detail exists) |
| Error | `isError` or result `status: 'error'` | verb + noun + Error badge + warning chrome; error text in **expand** (required for generation failures) |
| Denied | `isDenied` (result starts with `[denied] `) or confirm `rejected` / `cancelled` | verb + noun + Denied badge + red chrome — do not rewrite the title to Denied / Failed |

`ToolBlock` strips the `[denied] ` prefix into `cleanResult` before your branch runs, so read
`isDenied` rather than sniffing the string again.

## allowExpand

When a tool row is nested inside a subagent card, `ToolBlock` runs with `allowExpand === false` and
the row must collapse to a single line. Every block that can appear inside a subagent needs the
degradation branch:

```tsx
if (!allowExpand) {
  return (
    <CompactLabeledToolRow
      icon={<ToolIcon icon="image" className="size-3 shrink-0 text-muted-foreground" />}
      label={t('chat.toolBlock.generatedVideo')}
      streaming={false}
    />
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
2. **Streaming / action / done trio** for every primary label — see [label grammar](#label-copy-and-casing-collab-grammar).
3. **Family namespace** when the tool set is multi-tool: `chat.toolBlock.collab.*`,
   `chat.toolBlock.archive.*`, `chat.toolBlock.browser.*`.
4. **Summary / count fragments** are separate keys (`agentCount`, `sessionCount`, `hitsFound`) so
   pluralization and word order can differ by locale without string concat hacks.
5. **Expand field labels** under `fields.*` (Title Case short nouns in EN).

Reference: collab keys in `packages/shared/src/i18n/en.ts` → `toolBlock.collab`; archive keys →
`toolBlock.archive`.

## Storybook first

Write stories under **`SuperOne/MCP Tools`** (catalog in `SuperOneMcpTools.stories.tsx`, detailed
galleries as `SuperOne/MCP Tools/<Family>`). Cover streaming, complete-with-data, complete-empty,
error, denied, and `allowExpand: false`. Fixtures should be **real captured tool output**, not
invented JSON.

For in-progress designs, keep the block unwired from `ToolBlock` until Storybook review. Stories
are cheap; a bad block discovered in a live session is not.

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
