# dsh `0.1.0-rc.8` → `0.1.1-rc.2` Upgrade

Status: **executed** — landed on `main`. §6 records what was verified and what verification found
that the diff alone did not show.
Last updated: 2026-08-23
Upstream: `deepseek-harness` `master` @ `b150a551b8`, release commit `aa6c361a97`
Related: [`deepseek-harness-integration.md`](./deepseek-harness-integration.md) (§11 owns the
version strategy) · [`dsh-rc8-upgrade-plan.md`](./dsh-rc8-upgrade-plan.md) (the previous bump)

---

## 1. Scope of the upstream release

| | rc.8 → 0.1.1-rc.2 |
|---|---|
| Commits | 207 (142 non-merge) |
| Files changed | 2416 (+30503 / −12485) |
| Files changed **inside `src/` of the 33 packages SuperOne mounts** | 26 |

The 26 are not spread evenly. **19 of them are one project** — the image pipeline
(`attachment-local`, `llm-deepseek`, `llm/content.ts`) — and the remaining seven are small.
Everything else in the release is the upstream Web client, i18n tooling, and CI.

**Published package churn**: exactly one package added upstream, `dsh-authorization`
(`packages/credentials/authorization`). It is **not pinned** — see §4.2. Nothing was removed.

`latest` is still not the line to install from, and it is now *inconsistent* across the family
(`dsh-tools` → `0.0.1-rc.1`, `dsh-permission-presets` → `0.0.1-rc.3`, `dsh-agent` → `0.1.0-rc.6`).
`next` is `0.1.1-rc.2` for every package. Exact pins remain mandatory.

The vendored cordis family did **not** move: `@deepseek-ai/cordis` 4.0.1,
`cordis-plugin-{group,include,loader,timer}` 1.0.1 / 1.0.6 / 1.0.2 / 1.1.3, `schemastery` 3.18.1.
Only the 91 `dsh-*` pins changed.

---

## 2. Breaking changes

### 2.1 `CredentialProvider` grew a second key space — caught by the type checker

The credential seam now answers two questions instead of one. A `CredentialRef` still answers
"what is behind this environment-variable name". A new `CredentialKey` (`<scope>/<id>`) answers
"what credential does this plugin hold for this id" — an api-key record or an authorization grant
a plugin obtained for itself. Nothing layers in that space, so five abstract members landed:

```
readRecord / describeRecord / listRecords / modifyRecord / deleteRecord
```

`SuperoneCredentialProvider` is `abstract`-derived, so this was a hard compile error rather than a
silent break — the one typecheck failure in the whole bump.

**Fix:** the record half reports an empty, unwritable space, which is the same answer
`describe`/`set` already give for a reference SuperOne does not hold. Rationale is in the source
comment on `readRecord`; the short version is that SuperOne's settings author *references*, not
grants, and opening a second store dsh would own is exactly what mounting `dsh-credentials-local`
was rejected for. Nothing in the shipped tree stores records (`llm-deepseek` resolves only
`credentialRef(apiKeyEnv)`), so this is inert today; a runtime-installed third-party plugin that
wants to persist a grant is refused explicitly rather than losing it on the next boot.

### 2.2 `ProjectionDefinition` was restructured — no SuperOne impact

`{ schema, view }` became `{ stateSchema, wire?: { viewSchema, view } }`, splitting host-only fold
state from the client view, plus a new `SessionProjectionStateMap` merge table. This breaks every
projection *registrant*; SuperOne only ever **reads** `ProjectionSnapshot`, so nothing moved.
Worth knowing before adding one.

### 2.3 `llm-deepseek` config: `maxRequestImageBytes` was removed

Replaced by `maxRequestFilesBytes` (128 MiB) / `maxInlineRequestImageBytes` (20 MiB), plus ten new
Files-API knobs. SuperOne sets none of them, so no schemastery validation error at mount — but the
key is gone, and setting it later would now throw.

---

## 3. Behavioural changes that ship with the bump

No code change required, but each is a real difference in what users see.

### 3.1 Images are normalized on admission instead of refused — the big one

`attachment-local`'s defaults moved a long way, and the policy changed shape with them:

| | rc.8 | 0.1.1-rc.2 |
|---|---|---|
| Max bytes, one submitted image | 3.5 MiB | **20 MiB** |
| Max bytes, one message | 100 MiB | **200 MiB** |
| Max pixels, one image | 40 M | **64 M** |
| Max side, one image | 2000 px (**refused** above) | **8192 px** |
| Stored raster | as submitted | **normalized**: long edge 2048 px, ≤ 4 MiB |

The old 2000px cap refused an ordinary phone photo. Now an oversized source is admitted and
downscaled once into a canonical stored encoding, and `ImageAttachmentRef.originalDimensions`
records what it came from. SuperOne mounts `LocalAttachmentStore` with `dshHome` only, so it
inherits all of this; `images.ts` hardcodes no limit of its own and needed no edit.

`readImage` verification still covers `attachmentId` / `mediaType` / `bytes` / `width` / `height`
only — the five fields `TrajectoryImageRef` mirrors — so the trajectory image fetch keeps working
even though the ref gained a field the mirror drops.

### 3.2 A text-only model no longer poisons a session that has images

`projectImagesForTextModel` replaces every image in the request history with a stable
`[image omitted because this model accepts text only; attachment sha256:…]` placeholder. Before
this, an image admitted for a vision model and then read back under a text-only one failed
serialization on *every* later turn.

SuperOne's own up-front refusal in `DeepseekRuntime.imageBlocksFor` stays: refusing at attach time
with a clear message is better than silently degrading, and it is what
`003a2e05 fix(deepseek): refuse an unusable composer image instead of dropping it` decided.
What changed is the blast radius when a user switches models mid-session — that is now survivable.

### 3.3 Large image payloads offload to the DeepSeek Files API

New `file-store.ts` / `files-api.ts` / `upload-index.ts` in `llm-deepseek`: images above the
per-request file bound are uploaded once, referenced by id, refreshed before expiry (7 days
default), and quota-recovered by deleting the oldest harness-owned files. Automatic; nothing to
wire. It does mean a vision session can make network calls SuperOne does not surface.

### 3.4 `read_image` reports the downscale it applied

The tool result now carries the request-image dimensions and the coordinate scale relative to the
stored raster, so a model reading a screenshot and then clicking a coordinate has the factor it
needs. Region reads were removed in the same change.

### 3.5 `bwrap` gained `--unshare-pid`

Linux only, and SuperOne's sandbox tier is macOS-first. Noted because it changes the probe
arguments too, so a `bwrap` build without PID-namespace support now fails detection rather than
mounting a weaker sandbox.

---

## 4. New capabilities

### 4.1 A vision model exists — adopted

`deepseek-v4-flash-vision-exp`, `inputModalities: ['text', 'image']`. This is the first
image-capable DeepSeek route, and `DEEPSEEK_MODEL_CATALOG` was written for this moment: its
comment said enabling one was a single entry.

Added as a third catalog row. SuperOne passes an explicit `models` list, so the model would
**not** have appeared on its own — the adapter's own default catalog is shadowed. Per-request
pixel and byte budgets are deliberately omitted so the adapter fills in its own defaults rather
than SuperOne keeping a second copy of them.

The picker, the composer image path, the attachment store and the send path were all already
wired, so the entry is the whole change. `deepseek-runtime-host.test.ts` now pins that the vision
route is the *only* one declaring image input — declaring it on a text-only row would admit an
image the adapter then refuses.

### 4.2 `dsh-authorization` — not adopted

New package: obtain a credential by asking the human, storing the result as a `GrantRecord`. Its
only consumer upstream is `llm-pi-ai`'s sign-in flow, which SuperOne does not mount (the
DeepSeek adapter resolves an api-key reference out of SuperOne's own store). Adopting it means
first deciding what SuperOne's answer to the record key space is — see §2.1.

### 4.3 Newly reachable, unadopted

- `AttachmentStore.readImageRequest(ref, policy)` — deterministic per-route request versions with
  a `variantId` cache key. The adapter uses it internally; a SuperOne-side consumer would be for
  showing the user what the model actually saw.
- `LlmService.prepareCall(provider, model)` — binds model resolution and the eventual stream to
  one adapter generation, so a settings change mid-flight cannot combine one generation's
  capabilities with another's endpoint.

---

## 5. What was changed

| File | Change |
|---|---|
| `packages/deepseek/package.json`, `apps/desktop/package.json` | 91 pins `0.1.0-rc.8` → `0.1.1-rc.2`, **+1 new pin** (§6.2) |
| `packages/deepseek/src/credentials.ts` | the five record members (§2.1) |
| `packages/deepseek/src/bundled-plugins.ts` | `DSH_VERSION` |
| `packages/deepseek/src/plugin-host/install.{ts,test.ts}` | prerelease-ordering example re-anchored (§6.1) |
| `apps/desktop/resources/agent-presets/{standard,code,minimal,cordis}/` | re-copied from upstream, deviation re-applied (§6.2) |
| `apps/desktop/src/main/deepseek/deepseek-runtime-host.{ts,test.ts}` | vision route (§4.1) |
| `apps/desktop/resources/agent-presets/README.md`, `docs/draft/deepseek-harness-integration.md` | pinned-version references |

Release-side, per the release skill: **the harness R2 mirror must be re-published** because the
pins moved. Do that before shipping a build that references `0.1.1-rc.2`.

---

## 6. Outcome

### Gates

- `bunx tsc --noEmit -p packages/deepseek/tsconfig.json` — clean.
- `bunx vitest run` in `packages/deepseek` — 182 passed / 27 files.
- Desktop deepseek-adjacent suites (`src/main/deepseek/`, `deepseek-backend`, `DshPluginsPage`,
  `trajectory/`, `model-selector/`, `chat-store/`) — 647 passed / 55 files.
- `bun run typecheck` — 33 cli / 18 desktop / 6 runtime errors, byte-identical to the
  pre-bump baseline. None are dsh-related; the repo has no green typecheck baseline, so the
  comparison is the gate, not the count.

### 6.1 The prerelease-ordering fixture had to move with the build

`install.test.ts` pinned "`^0.1.0` is a mismatch against `0.1.0-rc.8`". That premise is about the
*build's own* release, not about `0.1.0` — and under `includePrerelease`, `0.1.1-rc.2` sits
comfortably inside `>=0.1.0 <0.2.0`, so the old fixture stopped failing and stopped testing
anything. Re-anchored to `^0.1.1`, with the reason stated in the test so the next bump moves it
rather than deleting it.

### 6.2 The rc.8 bump skipped the vendored presets, and it hid a Windows-only break

`apps/desktop/resources/agent-presets/README.md` says to re-copy all four presets whenever the pin
moves. That did not happen at rc.8, so the vendored copies were still **rc.7 text** — and rc.8 is
where upstream gave `minimal` a Windows shell stack (`terminal-bash` gated off win32, a
`shellDialect: pwsh` twin, and `@deepseek-ai/dsh-tool-pwsh-persistent`).

Two consequences, both latent:

- SuperOne's `minimal` preset had no Windows shell path at all — the rc.7 shape mounts bash
  unconditionally.
- After re-copying, `@deepseek-ai/dsh-tool-pwsh-persistent` is composed but was in neither
  manifest. On macOS the row's `disabled: !!js process.platform !== 'win32'` is true so the module
  is never imported, which is exactly why this could sit undetected. On Windows it resolves — and
  would have failed.

`bundled-plugins.test.ts` caught it, because it scans preset text rather than the mounted set and
cross-checks every discovered name against `package.json`. That test is the reason this is a
paragraph in a doc instead of a Windows bug report; the presets are text SuperOne vendors, so
nothing else in the toolchain looks at them.

Verified after the re-copy: `diff -r` against upstream shows the documented deviation and nothing
else — the banner plus four `backgroundMode:` rows per delegating preset rewritten to
`enableRunInBackground: false`.

### 6.3 The rc.8 follow-up worked

rc.8's silent `CommandRuntime.execute` break was fixed by binding `ctx.get(...)` reads to the real
upstream service types (`a6e0c098`). Every service signature change in this release would have
been a compile error, and the only one that mattered (§2.1) was. That follow-up paid for itself in
one bump.

### 6.4 The catalog was declaring a context window it had no way to know

`DEEPSEEK_MODEL_CATALOG` carried `contextWindow: 128_000` on every row. It arrived unexplained in
`c4cf795f feat(deepseek): serve dsh credentials from SuperOne's own store` — a credentials commit
— and predates this bump.

Nothing in the DeepSeek API reports capacity, so `modelInfoFor` reads
`configured?.contextWindow ?? connection.defaultContextWindow`: an explicit entry always wins, and
the adapter's own 1,000,000 never got a chance. That number is not only a progress ring —
`compaction-basic` computes `thresholdTokens = floor(contextWindow * 0.8)`, so SuperOne was
compacting at 102,400 tokens where DeepSeek's own harness team's figure puts the trigger at
800,000.

The tell that 128k was a reflex rather than a decision: SuperOne never set `defaultContextWindow`
either, so an **unlisted pass-through** model id already resolved to 1M. One provider, two answers.

Resolved by dropping `contextWindow` from all three entries rather than restating 1M. Both give the
same capacity today, but deferring means the figure moves with the pin instead of ageing in our
tree, and the catalogued and pass-through routes can no longer disagree. Pinned by a test — the
comment explains the compaction consequence so the next person to add a number knows what it costs.

### 6.5 Not done

- **Manual verification** on a live DeepSeek session: attach an image on the vision route, switch
  to `v4-pro` mid-session and confirm the placeholder path (§3.2), attach something over the old
  3.5 MiB / 2000 px caps to see normalization (§3.1).
- **Windows `minimal` preset** — §6.2 fixes the composition and the pin, but nothing here ran it.
