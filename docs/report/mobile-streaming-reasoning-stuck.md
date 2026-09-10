# Mobile: live turn stuck on Reasoning, following text never paints

Date: 2026-09-09
Status: **diagnosed; ready to implement**
Observed: Grok (ACP) session on the Expo remote-control app. Other harnesses not confirmed; Grok is the likely amplifier, not a unique mapper bug.

This is a handoff. The chat-view renderer is **not** the primary defect. Do not start by rewriting `ReasoningBlock` or Streamdown. Fix the RN → WebView paint path, then add a thinking→text live-stream e2e.

---

## 1. Symptom

During a streaming assistant turn on mobile:

1. The Reasoning block stays in the live state (pulsing brain, “Thinking…”).
2. The following assistant text (the streamed markdown / “token” block) never appears.
3. It happens **often**, not always. Reported on Grok; desktop of the same session is fine.

“Token block” here means the assistant **text** segment after reasoning (`ContentBlock.type === 'text'` rendered by `PortableMarkdown` / Streamdown), not the turn-footer token counters.

---

## 2. Why the UI looks “stuck”

ACP Grok maps:

| ACP update | SuperOne delta |
|---|---|
| `agent_thought_chunk` | `content_delta` `{ type: 'thinking' }` |
| `agent_message_chunk` (text) | `content_delta` `{ type: 'text' }` |

Mobile chat-view groups consecutive thinking blocks, then treats later text as a sibling segment. Reasoning is sealed only when it is **not** the last segment, or the session is no longer streaming:

```245:247:packages/chat-view/src/presenters/ClaudeTurnBody.tsx
    const sealed = options.forceSealed
      || !options.isStreaming
      || segmentIndex < segments.length - 1
```

`ReasoningBlock` stays expanded and labelled “Thinking…” while `blockDone` is false (`packages/chat-view/src/presenters/ReasoningBlock.tsx`).

So if the WebView’s last successful snapshot still has **only** a thinking block, the phone will sit on Reasoning forever, even when desktop already has the text.

When thinking **and** text are both in the message, the renderer does the right thing: reasoning seals (and collapses), text paints under `.after-thinking`. That contract is covered by:

```
packages/chat-view/src/portable-turn-status.test.ts
  describe('Grok live reasoning then text')
```

Do **not** treat a collapsed reasoning header as the bug. The live pulsing “Thinking…” state with no following `.chat-md` is the bug.

---

## 3. Ruled out

These were checked and are **not** the cause when the WebView actually receives both blocks.

| Hypothesis | Why it is not the bug |
|---|---|
| ACP maps Grok message chunks as thinking | `mapSessionUpdate` in `apps/desktop/src/main/acp/acp-event-map.ts` (~L861–890) and `packages/acp/src/agent-event-mapper.ts` (~L86–115) emit `text` vs `thinking` correctly. Empty chunks are dropped (`if (!text) return []`), which is fine. |
| `applyContentDelta` merges text into thinking | `packages/shared/src/content-delta.ts` only concatenates same-type same-parent runs. A text delta after thinking appends a new `text` block. |
| Remote strip/coalesce eats the type switch | Live `thinking`/`text` deltas are forwarded unchanged (`apps/desktop/src/main/remote-control-service.ts` ~L668–674). Coalesce keys include delta kind (`packages/shared/src/agent-event-batcher.ts`); sequenced events are not folded. Tests in `remote-control-service.test.ts` assert thinking-before-text order. |
| Compact chat mode hides the text | `PortableClaudeTurn` sets `detailChatMode={false}` but compact partitioning is skipped while `isStreaming` (`ClaudeTurnBodyPresenter` ~L403). |
| Streamdown `isAnimating` fade leaves text at opacity 0 | `CopyableMarkdownPresenter` passes `isAnimating={isStreaming}` but **not** `animated`. Streamdown’s stagger plugin only runs when `animated` is truthy. |
| chat-view cannot render thinking then text | SSR of `PortableMessage` with both blocks includes the text and `.after-thinking` (see test above). |

Desktop uses the same AgentEvents and the same grouping presenter. If desktop shows the answer, the mapper and reducer produced the text. The miss is after that, on the phone paint path.

---

## 4. Root cause (ranked)

### P0 — RN injects the **full transcript** into WKWebView via `injectJavaScript` every ~33ms

**This is the defect to fix.**

Paint path:

1. `ChatRuntime` batches agent events at `AGENT_EVENT_BATCH_MS` (33ms) and calls `onPaint`.
2. `syncSheets` in `apps/mobile/src/navigation/mobile-app.tsx` (~L334–354) builds `{ type: 'applyReductionPatch', messages: transcriptFor(runtime.session), … }`.
3. `injectHostMessage` stringifies that object and evals it:

```76:78:apps/mobile/src/native-actions.ts
export function injectHostMessage(ref: RefObject<WebView | null>, message: unknown): void {
  ref.current?.injectJavaScript(`globalThis.__applyHost(${JSON.stringify(message)});true;`)
}
```

Problems that stack on a Grok thought stream:

1. **Full snapshot, every tick.** The payload is every restored message plus the growing live turn, not a patch of the last assistant. Design contract in `docs/design/chat-core-contracts.md` §7 already says “pre-reduced patches”; the host currently sends the whole array.
2. **`injectJavaScript` is evaluateJavaScript.** WKWebView (and RN WebView’s wrapper) can silently fail or drop overlapping evals when the source string is large or when a previous eval has not finished. There is no completion handler, no retry, no size guard.
3. **Grok amplifier.** Thought chunks are long and frequent. Each successful inject is bigger than the last. Once one inject fails, later ones (thinking + text) are larger still, so the WebView can remain frozen on the last thinking-only snapshot for the rest of the turn.
4. **U+2028 / U+2029.** `JSON.stringify` may emit line/paragraph separators that are illegal in a JS *source* string on older JSC. A single such character in Grok reasoning makes the whole eval a SyntaxError, swallowed by RN WebView.

Desktop never takes this path, which is why the same Grok session looks fine there.

### P1 — No live-stream coverage for thinking → **text**

`packages/chat-view/e2e/live-stream.spec.ts` only exercises thinking → **tool** (then text after complete). Grok’s common shape is thinking → prose with no tool in between. A renderer regression of that shape would not fail CI. Add this after the inject fix, not instead of it.

### P2 — Confirm after-turn behaviour (do this while reproducing)

| After the turn settles on mobile | Interpretation |
|---|---|
| Text still missing | WebView never applied a snapshot that contains the text block (inject drop, or restore still thinking-only). |
| Text appears only when the turn completes | Injects were lagging/dropping during the stream; the final idle paint got through. Still fix P0. |
| Desktop missing the text too | Re-open mapper/event routing (unexpected). Not what was observed. |

Relay overflow (`apps/relay/src/relay-session.ts`, `MAX_BUFFER_SIZE = 500`) drops **oldest** frames, not newest, so it would lose early thinking rather than the trailing text. LAN has no such buffer. Treat relay overflow as a secondary check only if the phone is on relay and ACKs stall.

---

## 5. Data flow (for orientation)

```
Grok ACP  session/update
  agent_thought_chunk → thinking delta
  agent_message_chunk → text delta
        ↓
desktop Session (seq assigned)
        ↓
RemoteControlService.sendAgentEvent   (thinking/text forwarded raw)
        ↓
LAN / relay → mobile ChatRuntime.ingest → chat-core applyEventToSession
        ↓
ChatRuntime.flush (≤1/33ms)
        ↓
syncSheets → injectHostMessage(JSON.stringify(ALL messages))   ← break
        ↓
chat-view __applyHost → applyReductionPatch → PortableClaudeTurn
```

WebView **must not** re-reduce AgentEvents. Keep that invariant. Change *what* is injected and *how*, not the reducer.

---

## 6. Implementation plan

Keep the change in `apps/mobile` (+ a chat-view e2e). Do not retune ACP thought/message mapping unless a new trace shows desktop also missing the text.

### PR1 — Reliable host → WebView paint (required)

**Goal:** a thinking snapshot followed by a thinking+text snapshot must both apply, including when the live thinking field is tens of KB.

Suggested shape (pick one; 1+2 together is best):

1. **Stop eval of a JSON literal.** Prefer `WebView.postMessage` / the RN `onMessage` reverse of the existing `ReactNativeWebView.postMessage` bridge, or inject a *string* and `JSON.parse` inside the WebView:

   ```ts
   // sketch only — match existing bridge helpers
   const payload = JSON.stringify(message)
     .replace(/\u2028/g, '\\u2028')
     .replace(/\u2029/g, '\\u2029')
   ref.current?.injectJavaScript(
     `globalThis.__applyHost(JSON.parse(${JSON.stringify(payload)}));true;`
   )
   ```

   Escaping U+2028/U+2029 is mandatory if eval is kept.

2. **Send a real patch, not the full array every tick.** Live `applyReductionPatch` should carry only messages that changed (typically the last assistant, plus a new user row on send). Full array remains correct for `hydrate` / reconnect. `ChatView.applyProjection` already treats omitted `messages` as “keep previous”.

3. **Optional but useful:** log / count inject failures. RN WebView `injectJavaScript` does not report errors today. If you stay on eval, wrap in a try/catch inside the injected script and `postHost({ type: 'error', fatal: false, … })` so a dropped paint is visible.

Do **not** send raw `AgentEvent`s into the WebView.

Files:

- `apps/mobile/src/native-actions.ts` — `injectHostMessage`
- `apps/mobile/src/navigation/mobile-app.tsx` — `syncSheets`
- `packages/chat-view/src/bridge.ts` / `protocol.ts` — only if the inbound envelope changes
- tests next to `native-actions` / `runtime` for payload shape and escaping

### PR2 — Live-stream e2e: thinking then text (required with PR1)

Extend `packages/chat-view/e2e/live-stream.spec.ts` (or a sibling) with an ACP/Claude-shaped turn:

1. hydrate empty
2. `applyReductionPatch` streaming message with a large `thinking` block → `.thinking-content` visible
3. same message id, append `{ type: 'text', text: '…' }` (no tool) → `.chat-md` contains that text; reasoning seals (`.thinking-content` count 0 or collapsed)
4. clock stays paused (no playback budget), same as the existing tool test

Also worth a host-side test: `injectHostMessage` / patch builder must not include unchanged older messages on a live tick.

### Out of scope

- Changing `collapseOnDone` on `ReasoningBlock`
- Enabling Streamdown `animated`
- ACP `eventSeq` dedup on the xAI notification rail (does not handle `agent_message_chunk`)
- Relay `MAX_BUFFER_SIZE` (unless repro is relay-only and ACKs are stuck)

---

## 7. Verification

Minimum:

```bash
# already landed
bunx vitest run packages/chat-view/src/portable-turn-status.test.ts

# after PR1
bunx vitest run apps/mobile/src/native-actions.test.ts
# plus whatever test file covers syncSheets / inject payload

# after PR2 (chat-view e2e — follow packages/chat-view existing playwright command)
```

Manual:

1. Pair the Expo app to desktop, open a **Grok** session, prompt something that reasons then answers in prose (no tool).
2. Watch mobile during the thought phase, then when desktop starts showing tokens.
3. Mobile must show the text within a frame or two of desktop, not only at turn end.
4. Repeat on a long-reasoning turn and on a session that already has a large transcript (this is the inject-size case).
5. Repeat once on Claude if convenient — should keep working; this path is harness-agnostic.

Pass: live Reasoning seals when text starts; `.chat-md` / visible prose appears during the stream; turn-end state matches desktop.

---

## 8. Existing breadcrumbs

| Item | Where |
|---|---|
| Live thinking sealed iff a later segment exists | `packages/chat-view/src/presenters/ClaudeTurnBody.tsx` |
| Reasoning live vs collapsed | `packages/chat-view/src/presenters/ReasoningBlock.tsx` |
| Mobile inject | `apps/mobile/src/native-actions.ts` `injectHostMessage` |
| Full-transcript paint | `apps/mobile/src/navigation/mobile-app.tsx` `syncSheets` |
| 33ms host batch | `apps/mobile/src/runtime.ts` `ChatRuntime.schedule` / `AGENT_EVENT_BATCH_MS` |
| Remote thinking/text passthrough | `apps/desktop/src/main/remote-control-service.ts` ~L668 |
| Grok ACP map | `apps/desktop/src/main/acp/acp-event-map.ts` `agent_thought_chunk` / `agent_message_chunk` |
| Host protocol intent | `docs/design/chat-core-contracts.md` §7 |
| Renderer contract test | `packages/chat-view/src/portable-turn-status.test.ts` “Grok live reasoning then text” |
| e2e gap (thinking → tool only) | `packages/chat-view/e2e/live-stream.spec.ts` |

---

## 9. Suggested commit

After the inject/patch fix (English, imperative):

```
fix(mobile): patch live chat-view turns without eval of the full transcript

Grok thought streams inflate the RN injectJavaScript payload until WKWebView
drops later snapshots, so the phone stays on the live Reasoning block and
never paints the following text. Send escaped parseable patches (or
postMessage) so thinking-then-text applies during the stream.
```
