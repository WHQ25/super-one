# Jev fast loop (`browser_run` / `computer_run` / `device_run`)

An experimental, goal-level tool per UI-automation line. Instead of one main-model
turn per click (`*_snapshot` → think → `*_act`), the main model states a goal once
and a loop in the Electron main process drives the UI, asking TypeSafe's System One
model Jev to pick each step from candidates the code built. The main model is asked
again only when the loop pauses. Code: `apps/desktop/src/main/jev/`.

The `*_run` tools sit beside `*_snapshot` / `*_act` / `*_query`; they replace none
of them. Tool descriptions route known sequences, single steps, gestures and pixel
work to `*_act`.

## Enabling

- Setting: **Settings → General → Experimental → Jev fast inner loop**
  (`AppSettings.jevFastLoopEnabled`, default off; row in
  `apps/desktop/src/renderer/src/components/settings/JevFastLoopSetting.tsx`).
  Turning it on without a key shows the key form first.
- The TypeSafe key lives in `app_meta`, encrypted with `safeStorage`, never in
  `AppSettings` (`jev/jev-api-key.ts`).
- While off, no surface lists the `*_run` tools (`run-tool-common.ts#isJevFastLoopEnabled`).
  Each tool also re-checks at call time, for callers holding a stale tool list
  (Codex snapshots tools once per thread) or a remote node's static catalog.
- Per-line prerequisites: `browser_run` needs browser CDP (Settings → Browser);
  `computer_run` needs Computer Use enabled and uses the existing app grants and
  tiers; `device_run` needs control already approved through
  `device_request_control` and never requests it.

## Division of labour

| Party | Owns |
|---|---|
| Main model | Launch: `goal` (phrased as the visible end state), `presets` (values to type; never passwords), optional `done_when`. Answers pauses. |
| Code | Control flow, observation, candidate construction, history and de-duplication, freshness, budgets, machine checks, execution, settle, abort, trace. |
| Jev | Choice and yes/no questions over the candidates code offers, one request per step. Generates no text or coordinates. |

Each step: observe → machine checks → build the action space → one Jev request →
`policy.ts#decide` → execute → settle → record history (`loop.ts#FastRun`).

**Machine checks run before Jev** is asked: an obstructed observation pauses; an
adapter loading signal waits (at most three in a row); a given `done_when` that
holds ends the run without a Jev request.

**Heads in one request are independent.** All questions are answered against the
same state, and no head can be conditioned on another head's answer. Anything that
depends on a previous answer takes two steps: a context-menu step opens the menu,
and the next observation offers its items as ordinary clicks.

## Pauses and resume

A paused result carries `question`, a fresh `snapshot` (with an image path and
coordinate space), `progress` (steps since the last pause with
`worked | didnt | unknown`, plus Jev's last `goal_satisfied` / `still_loading`) and a
`next` hint. The caller resumes with `runId` + `answer`; `abort` hands control back,
and no-progress and value pauses also offer `accept` (the goal is reached as the
page stands).

| Reason | When |
|---|---|
| `risky` | Jev rates the step it chose irreversible |
| `uncertain` | A typing target is below the write gate, or no preset matched the chosen field |
| `no-progress` | Nothing offered advances the goal and the page cannot scroll further, or three steps changed nothing |
| `budget` | `maxSteps` (default 30) or `maxWallMs` (default 45 s, under harness tool timeouts) reached |
| `capability` | Jev chose `needs_input`; see hand-over below |

Paused runs are held for 5 minutes, owned by the session and bound to their platform
(`run-store.ts`). A paused browser run holds no focus guard.

## Irreversible steps

Every request asks `next_step_risk` about the step Jev picked. At or above
`THRESHOLDS.risk` (0.5) the loop pauses and the main model confirms that step, picks
another, or takes over. Code keeps no label lists for risk. The hard exclusions are
not risk judgements: password and secure fields are never candidates and their
values are never read, and grants and device control are never requested by the
loop. Actions the caller hands over at a capability pause run as approved.

## Thresholds and model pin

`typesafe-client.ts#JEV_MODEL` pins `jev-1.13.0`. `policy.ts#THRESHOLDS` is
calibrated against that version (`goalSatisfied` 0.7, `goalSatisfiedIdle` 0.4,
`stillLoading` 0.7, `write` 0.7, `presetMatch` 0.7, `overrideNone` 0.8, `risk` 0.5);
clicks have no confidence gate. Bump the model only together with a recalibration.
Every step appends to `userData/jev-traces/<runId>.jsonl` with all head
probabilities, the decision, latency and staleness, so thresholds can be re-fit
(`trace.ts`).

## What can be handed to Jev

An action is offered to Jev only when all four hold:

| Criterion | Meaning |
|---|---|
| Enumerable target | A named candidate in the observation, not a coordinate |
| Enumerable or preset parameters | Every parameter is enumerable from the observation or supplied in advance as a preset |
| Effect visible in text | The result shows up in the observation text or elements |
| Cheap to get wrong | A wrong pick costs one re-observation; irreversible picks are caught by the risk pause |

Jev never chooses coordinates or geometry, free text, or grants. When the goal needs
such input, Jev picks `needs_input` with `hand_target` and `input_kind`
(`position | path | text | value | other`, a hint only); the pause takes
`{ actions?, presets? }` in the platform's own `*_act` vocabulary, and the loop
executes the handed actions itself (`RunDeps.act`).

Action options (`questions.ts#ACTION_OPTIONS`): `click`, `type_text` (replace),
`append`, `scroll_down` / `scroll_up`, `escape`, `switch`, `context_menu`, `drag`,
`needs_input`, `none_useful`. A head appears only when the adapter offers
candidates for it.

## Completion

Jev decides completion from the observation text:

- `goal_satisfied` ≥ 0.7, or ≥ 0.4 while `none_useful` ≥ 0.8, marks a candidate;
  the loop settles, re-observes, and finishes only if the fresh read agrees.
- `done_when` is a fast path checked before every ask. It never vetoes Jev's
  verdict: a condition bound to a ref the app has since replaced may never match,
  and the completion reason then says `(done_when never matched)`.
- Evidence must be in the text, so adapters write state sentences: an
  `(observing: …)` line naming the window or screen and any open sheet or dialog,
  `(X: inside Y)` for rows under an expanded folder, icon positions in icon view,
  what a text area ends with, switch states such as `Airplane mode: on`, and
  `(picture-only: X)` for pictures. The shared `goal` description asks for the end
  state in the same terms ("Report.txt is listed inside Archive", not "drag
  Report.txt onto Archive").

## Adapters

| Line | Tool entry | Adapter | Notes |
|---|---|---|---|
| Browser | `jev/browser-run-tool.ts` | `jev/browser-page.ts` | CDP from main: in-page snapshot with node identity, scoped freshness, `readyState` loading signal, event-driven settle and wait; handed actions reuse `browser_act`'s mapping (`mcp/browser-act.ts`) |
| Computer | `jev/computer-run-tool.ts` | `jev/computer-page.ts` | Computer Use service outline; launches the named app in the background if needed; scroll areas, append, Escape, root switch, right-click, drag onto drop targets (a covered drop point is noted in the text); lowers SuperOne's own windows under a drop point (`jev/own-windows.ts`) |
| Device | `jev/device-run-tool.ts` | `jev/device-page.ts` | Semantic tree; Back key (Android) or edge swipe (iOS) as `escape`, long-press as `context_menu`; always re-observes on resume |

Shared pieces: `loop.ts` (coroutine, pause/resume, abort), `policy.ts`,
`questions.ts`, `action-space.ts`, `settle.ts`, `run-store.ts`, `trace.ts`,
`run-tool-common.ts`. Remote nodes see the tools through
`packages/shared/src/environment/host-action-{browser,computer,device}-descriptors.ts`.
