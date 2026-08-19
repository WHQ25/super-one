# dsh `0.1.0-rc.7` → `0.1.0-rc.8` Upgrade

Status: **executed** — landed on `chore/dsh-rc8`. Steps 1–5 are done; §7 records what was verified
and where verification corrected the analysis.
Last updated: 2026-08-20
Upstream: `deepseek-harness` `master` @ `141eb6fef8`, tag `dsh-v0.1.0-rc.8`
Related: [`deepseek-harness-integration.md`](./deepseek-harness-integration.md) (§11 owns the version strategy)

---

## 1. Scope of the upstream release

| | rc.7 → rc.8 |
|---|---|
| Commits | 536 |
| Files changed | 1604 (+54064 / −10533) |
| Files changed **inside packages SuperOne pins** | 22 (excluding tests/snapshots) |

The size is misleading. 429 of the changed files are `packages/client` (the upstream Web UI,
which SuperOne does not consume) and 285 are `.agents/notes`. SuperOne mounts 31 plugins
from 90 pinned packages; filtering the diff to those collapses it to a reviewable surface.

**Published package churn** (all under the `next` dist-tag; `latest` is still the unrelated
`0.0.1-rc.1` line, so exact pins remain mandatory):

- Added, published: `dsh-tool-pwsh-persistent`, `dsh-file-reference`, `dsh-file-reference-local`,
  `dsh-code-runtime-python`, `dsh-client-ui-{brand-official,reference,renderer}`
- Added, **not published (npm E404)**: `dsh-experimental-agent-team`, `dsh-experimental-tool-agent-team`
- Removed: `dsh-client-schema-form`, `dsh-client-web-react` — **neither is pinned by SuperOne**, so
  the removal is a no-op for us.

---

## 2. Breaking changes

### 2.1 `CommandRuntime.execute()` gained a positional parameter — SILENT BREAK

**This is the only hard break, and the type checker will not catch it.**

```diff
- execute(agent: Agent, line: string, signal: AbortSignal)
+ execute(agent: Agent, line: string, images: readonly EncodedImageAttachment[], signal: AbortSignal)
```

SuperOne calls this exactly once, in `DeepseekRuntime.compactSession()`
([`packages/deepseek/src/runtime.ts:990`](../../packages/deepseek/src/runtime.ts)):

```ts
const commands = (this.bridge as Context & { get(name: string): unknown })
  .get('commands') as {
    execute(agent: Agent, line: string, signal: AbortSignal): Promise<…>
  } | undefined

const execution = await commands.execute(record.agent, '/compact', signal ?? new AbortController().signal)
```

Because the service is resolved through `ctx.get('commands')` and re-typed with a **locally
declared structural type**, `bun run typecheck` stays green while the call is wrong at runtime.
The `AbortSignal` lands in the `images` slot and `signal` becomes `undefined`; rc.8's `execute`
dereferences `signal.aborted` on its 11th line, so **manual `/compact` fails with
`TypeError: Cannot read properties of undefined (reading 'aborted')`** on the first invocation.

**Fix:** add the empty images argument and widen the local structural type.

```ts
execute(
  agent: Agent,
  line: string,
  images: readonly never[],
  signal: AbortSignal,
): Promise<{ result: { kind: 'success' | 'error'; text?: string } } | undefined>
```

```ts
const execution = await commands.execute(
  record.agent,
  '/compact',
  [],
  signal ?? new AbortController().signal,
)
```

**Follow-up worth doing in the same change:** this hand-written structural cast is what hid the
break. Every other `ctx.get(...)` cast in `runtime.ts` carries the same risk (`attachments` at
`runtime.ts:807` is the other one). Consider importing the real service types where the isolate
realm permits it, or at minimum adding a runtime arity assertion, so the next signature change
fails loudly. See §6.

### 2.2 `reportDelivery: 'wakeup'` was removed from the schema union

`dsh-tool-subagent-report` config:

```diff
- reportDelivery: z.union(['quiet', 'wakeup']).default('wakeup')
+ reportDelivery: z.union(['quiet', 'next-step']).default('next-step')
```

SuperOne does not set `reportDelivery` anywhere (verified: no hits in `packages/deepseek` or
`apps/desktop/resources`), so no schemastery validation error at mount. **But the default
behaviour changes**: a subagent report used to create one ordinary later parent turn; it now
wakes the parent and enters at its nearest step boundary. Re-verify the Task-block rendering
and the parent's turn boundaries after upgrading — SuperOne's event mapper keys message
open/close off `step/start` and `turn/end`.

---

## 3. Behavioural changes that ship with the bump

No code change required, but each needs re-verification.

### 3.1 `assistant/message` gains `interrupted?: true`

`dsh-session/types.ts` + `agent-loop/agent.ts`. A turn cancelled mid-stream now finalizes its
delivered text/reasoning prefix as an `assistant/message` carrying `interrupted: true`
(undispatched tool calls are omitted; `BlockAssembler.interruptedBlocks()` is the new seam).
Previously a cancelled turn emitted no such event at all.

Impact on SuperOne: [`event-map.ts:193`](../../packages/deepseek/src/event-map.ts) reads **only
`usage`** from this event — assistant text is rendered from `assistant/chunk`. So:

- ✅ No double render of the interrupted prefix.
- ⚠️ **Token accounting changes**: spend on a cancelled turn used to be silently dropped and is
  now counted into `turnUsage` / the context ring. This is arguably a fix, but the numbers users
  see after pressing Stop will move.
- 💡 Opportunity: `interrupted: true` is a cleaner interruption signal than re-deriving it from
  `turn/end` reason. SuperOne currently marks the message interrupted from `turn/end`
  ([`event-map.ts:242`](../../packages/deepseek/src/event-map.ts)); the new marker distinguishes
  "streamed a partial answer" from "aborted with nothing visible" (no event ⇒ nothing streamed).

### 3.2 LLM retry default 2 → 5

`dsh-llm/retry-policy.ts`, `DEFAULT_MAX_RETRIES`. Also: `always` mode now tolerates
`maxRetries` / `retryableCodes` keys instead of rejecting them (layered config after a mode switch).

Impact: transient provider failures retry roughly 2.5× longer before surfacing. Combined with
the default backoff (500 ms initial, 10 s cap) the worst-case tail grows noticeably. **Decide
whether to pin `retryPolicy.maxRetries: 2` in SuperOne's preset** to preserve today's
responsiveness, or accept the upstream default. Recommendation: accept it, but confirm the Stop
button still cuts through promptly — a user-visible "stuck" window is the risk.

### 3.3 `reasoning_content` is now passed back on every reasoned turn

`llm-deepseek/types.ts` + `serialize.ts`. Was: required only on tool-call turns in thinking mode,
omitted elsewhere to save tokens. Now: present on every turn whose assistant content carried
reasoning, so a gateway re-encoding for another vendor can recover the thinking signature by
hashing it. Fixes an upstream "reasoning content missing" bug.

Impact: strictly better fidelity; request token counts go up on reasoning-heavy sessions.

### 3.4 HTTP 413 now classifies as `INVALID_REQUEST`

`llm-deepseek/adapter.ts`, `httpErrorCode()`. Supports the multimodal work below. Check that
SuperOne's error surface renders `INVALID_REQUEST` sensibly.

### 3.5 `read_image` produces better tool errors

`tool-fs/read-image.ts` now converts `IMAGE_DIMENSION_TOO_LARGE` and `IMAGE_TOO_MANY_PIXELS`
into recoverable, actionable tool errors instead of throwing raw `AttachmentError` — an
oversized image must never enter durable history, where it would ride every later model request.
`ImageAttachmentLimits` gains `maxImageDimension`.

---

## 4. New capabilities (opt-in — none active from the bump alone)

### 4.1 DeepSeek native multimodal — the highest-value item

New in `llm-deepseek`:

- `DeepSeekCatalogModel.inputModalities: ('text' | 'image')[]` — omission is text-only; validated
  for emptiness, unknown values, and duplicates.
- `Config.maxRequestImageBytes` (default `DEFAULT_MAX_REQUEST_IMAGE_BYTES` = 20 MiB).
- `DeepSeekAdapterOptions.resolveAttachments?: () => AttachmentStore | undefined` — the plugin
  wires `() => ctx.get('attachments')`; **absence rejects image input**.
- `WireUserMessage.content` widened from `string` to `string | WireUserContentPart[]`
  (`{type:'text'}` / `{type:'image_url', image_url:{url}}`).
- `dsh-llm-deepseek` now declares `@deepseek-ai/dsh-attachment` as a **peerDependency**.

New in `dsh-llm/content.ts`: `offloadRequestImages(messages, maxRequestImageBytes)` — when the
accumulated base64 payload exceeds the bound it replaces the **oldest** images with
`OFFLOADED_IMAGE_TEXT` placeholder blocks rather than failing the request. Deterministic from
durable message order and attachment metadata; the provider never reads the omitted bytes.

**SuperOne's gap.** We are text-only today on both ends of the seam:

- [`tree.ts`](../../packages/deepseek/src/tree.ts) mounts 31 plugins and registers **no attachment
  service**. `runtime.ts:807` reaches for `ctx.attachments` defensively (`attachments?: {…}`) and
  returns `null` when absent — so `read_image` results currently cannot resolve to bytes either.
- [`runtime.ts:637`](../../packages/deepseek/src/runtime.ts) sends
  `createUserMessage({ content: [{ type: 'text', text }] })`. No image path exists.

Wiring it up is a self-contained feature, not part of the bump. Sketch:

1. Mount `dsh-attachment` + `dsh-attachment-local` in `tree.ts` (pinned already; verify the
   isolate realm placement so `ctx.get('attachments')` resolves from the llm plugin's context).
2. Mark image-capable models with `inputModalities: ['text','image']` in the catalog SuperOne
   feeds to `LlmDeepseek` — check which DeepSeek models actually accept images before doing this;
   an uncatalogued endpoint is deliberately treated as text-only upstream.
3. Extend the followup/prompt path to admit SuperOne's composer image attachments into
   `ImageBlock`s (`admitEncodedImages(store, images)` from `dsh-attachment` is the upstream helper).
4. Decide the `maxRequestImageBytes` value; 20 MiB default with oldest-first offload is a
   reasonable start.

**Note the ordering dependency:** because `dsh-attachment` is now a peerDependency of
`dsh-llm-deepseek`, it must stay pinned in both `package.json` files regardless of whether we
mount it — otherwise it is missing from the asar (see the known peer-deps-in-asar footgun).

### 4.2 Slash commands can accept images

`CommandInputDescriptor.images?: boolean`; `CommandInvocation` gains a required readonly
`attachments: readonly ImageBlock[]`. Admission is enforced **in the registry, not the composer**:
images sent to a command that does not declare `input.images`, an absent attachment store, and an
exceeded limit each settle as an error result before the handler runs, publishing no durable object.
Cancellation is honoured *before* the handler runs, after admission.

SuperOne owns its own slash surface, so this only matters if we start routing image-carrying
commands through `dsh-commands`. It is the reason for the §2.1 signature break.

### 4.3 Subagent surfaces

- `SubagentResult.diagnostic?: string` — provider-authored failure detail for a non-`completed`
  result, guaranteed free of tool inputs, file contents, environment values, credentials, and raw
  protocol payloads, capped at 4096 UTF-8 bytes. `tool-subagent` already folds it into the thrown
  error text, separated from the child's assistant output. **SuperOne could surface this in the
  Task chip's failure state** instead of the current generic message.
- `SubagentRuntime.drainContinuableChildren(parent, childIds)` — selectively release resident
  continuable direct children instead of `drainDescendants()`'s all-or-nothing. Relevant to the
  still-pending "background/continuable children" work in the integration doc.

### 4.4 Newly available packages

| Package | Note |
|---|---|
| `dsh-tool-pwsh-persistent` | Persistent PowerShell PTY, parallel to `tool-bash-persistent`. Windows story. |
| `dsh-file-reference`, `-local` | `@`-mention file/directory discovery bounded by session cwd, with cancellation. SuperOne has its own mention system — evaluate before adopting. |
| `dsh-code-runtime-python` | Python code runtime. |
| `dsh-session-persistence-sqlite` | Rewritten in this release (v2 chunk packing + compression + a full extracted SQL resource set). SuperOne uses `session-persistence-jsonl`. A migration is a separate evaluation — note the known "vitest cannot use real better-sqlite3" constraint. |

### 4.5 Agent Teams — blocked

Four new session event types are registered upstream (`team/member`, `team/task`,
`team/message/queued`, `team/message/delivered`) and `tool-cordis`'s API catalog gained the full
Agent Teams surface (roster, task board CAS transitions, peer messaging, teammate interrupt).
The implementing packages `dsh-experimental-agent-team` / `dsh-experimental-tool-agent-team`
**return E404 on npm**, so this cannot be adopted at rc.8. Track for a later release.

⚠️ Because `tool-cordis`'s api-catalog grew by ~205 lines, SuperOne's
[`tool-cordis.test.ts`](../../packages/deepseek/src/tool-cordis.test.ts) may assert on a catalog
shape that has moved. That file already has uncommitted local changes — reconcile carefully.

---

## 5. Execution plan

Branch: `chore/dsh-rc8`, cut from `main`. Do **not** mix with the in-flight trajectory work
currently dirty in the tree.

### Step 1 — Mechanical pin bump (180 edits)

Two files, 90 pins each:

- `packages/deepseek/package.json`
- `apps/desktop/package.json` (peer declarations; missing entries here pass in dev and crash the
  packaged asar)

```bash
sed -i '' 's/"0\.1\.0-rc\.7"/"0.1.0-rc.8"/g' \
  packages/deepseek/package.json apps/desktop/package.json
bun install
```

Then verify the two lists stayed identical:

```bash
diff \
  <(grep -o '"@deepseek-ai/[^"]*": "[^"]*"' packages/deepseek/package.json | sort) \
  <(grep -o '"@deepseek-ai/[^"]*": "[^"]*"' apps/desktop/package.json | sort)
```

### Step 2 — Fix the silent break (§2.1)

Patch `compactSession()` in `packages/deepseek/src/runtime.ts`. **Add a regression test** that
exercises `/compact` through the real `commands` service — a type-level test cannot catch this
class of break.

### Step 3 — Gates

```bash
bun run typecheck
bunx vitest run apps/desktop/src/main/deepseek/          # from apps/desktop cwd
bun run test                                             # needs sandbox disabled (LAN/mDNS binds)
```

Targeted suites most likely to move: `packages/deepseek/src/{runtime,compaction,subagent,tool-cordis,presets}.test.ts`.

### Step 4 — Manual verification matrix

| What | Why |
|---|---|
| Manual `/compact` on a live dsh session | §2.1 — the break |
| Press Stop mid-stream, check transcript + token footer | §3.1 — `interrupted` event, usage now counted |
| Run a foreground subagent to completion and to failure | §2.2 report delivery, §4.3 `diagnostic` |
| Force a transient provider failure | §3.2 — retry tail, Stop responsiveness |
| Reasoning-heavy session, check reasoning renders | §3.3 |
| `read_image` on an oversized image | §3.5 — new error text |

### Step 5 — Docs

Update the rc.7 references in:

- `docs/draft/deepseek-harness-integration.md` (lines 31, 43, 335, 373, 378, 393, 879, 1113, 1316, 1388 — note 1267 tracks a *different* package's rc.6 drift, re-check it)
- `apps/desktop/resources/agent-presets/README.md:4`
- `packages/deepseek/src/plugin-host/install.ts:144` and `install.test.ts:57,61,67,76` — these
  encode the `^0.1.0` vs `0.1.0-rc.N` prerelease-ordering explanation in comments and fixtures.

### Step 6 — Release-side

Per the release skill: the harness R2 mirror must be re-published when pins change. Do this
before shipping a build that references rc.8.

---

## 6. Recommendation

Land Steps 1–5 as one reviewable commit (`chore(deepseek): upgrade dsh to 0.1.0-rc.8`), with the
`compactSession` fix and its regression test included — splitting them would leave `main` with a
broken `/compact`.

Treat as **separate follow-ups**, each on its own branch:

1. **Native multimodal** (§4.1) — the genuinely new user-facing capability.
2. **Harden the `ctx.get()` casts** (§2.1 follow-up) — this upgrade demonstrated that SuperOne's
   structural re-typing of dsh services converts upstream signature changes into silent runtime
   failures. That is a recurring cost across every future rc bump, not a one-off.
3. **Subagent `diagnostic` in the Task chip** (§4.3) — small, self-contained UX win.

---

## 7. Outcome

Landed as `chore(deepseek): upgrade dsh to 0.1.0-rc.8`. Steps 1–5 executed; Step 6 (release-side
R2 mirror re-publish) is still owed before shipping a build that references rc.8.

### Gates

| Gate | Result |
|---|---|
| `bun --filter @superone/deepseek test` | 24 files / 160 tests passed |
| `bun run test` (desktop + shared + ui) | 624 files / 7840 passed, 21 skipped |
| `bun run typecheck` | 51 errors — **verified pre-existing** |
| Pin lockstep (both files) | 90 rc.8 pins each, no residual rc.7 |

The 51 typecheck errors were checked the only way that proves anything: the base commit was
checked out **in the same worktree**, under the same install state, and re-typechecked. Same
count, same per-workspace distribution (`cli` 33, `desktop` 11, `runtime` 7), and `comm -3` over
the two sorted error sets returned zero lines. None are in `@superone/deepseek`. They are a
pre-existing debt on `main`, not fallout from this upgrade.

### Two things verification corrected in this analysis

**§2.1 overstated the silence.** The break is silent to `typecheck`, as described — but *not* to
the test suite. Reverting the one-line fix turns all four `compaction.test.ts` cases red with
exactly the predicted `TypeError: Cannot read properties of undefined (reading 'aborted')`,
including the three that already existed. Running `bun --filter @superone/deepseek test` would
have caught it on its own. The added regression test is a targeted assertion on the argument
positions, not the only guard.

That is also why the regression test was checked by **removing the fix and confirming the test
fails**. A green test only proves the current code passes; it does not prove the test can detect
the defect. Several "regression tests" are really tests of their own mock.

**The predicted test fallout did not materialise.** §3 and the implementation brief expected
`tool-cordis.test.ts` (upstream's API catalog grew ~205 entries), `subagent.test.ts`
(`reportDelivery` default moved to `next-step`), and cancelled-turn usage assertions to need
updating. None of the three went red — those suites do not assert on the details that drifted.

### One inherited claim that rc.8 invalidated

`deepseek-harness-integration.md` §"dual-package hazard" states that `@deepseek-ai/dsh-app-boot`
sits at rc.6 while the family moved ahead, so lockstep is broken there. That was true at rc.7.
As of rc.8 `dsh-app-boot` publishes `0.1.0-rc.8` in lockstep with the family, so the stated
blocker is gone — the sentence has been corrected rather than version-bumped.

### Still not done

Step 4 of §5 (the manual verification matrix) needs a running app and was not performed. The
rows that matter most, because they are behaviour changes rather than compile-time ones:

- manual `/compact` against a live dsh session (§2.1 — the break itself)
- Stop mid-stream, then read the transcript and the token footer (§3.1 — cancelled-turn usage is
  now counted where it used to be dropped)
- a transient provider failure, to feel the retry tail at the new default of 5 (§3.2)
