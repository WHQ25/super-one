# Input surfaces: composers and entry points

Status: draft · Updated: 2026-10-05

Scope: make the composer slot programmable. A **composer** is a self-contained
input surface that produces one submission — the chat composer, a permission
prompt, an image-generation form, a mini-app form. Users, mini-apps, widgets
and agents open composers through one API, and fixed patterns (image, video,
decision prompts) become reusable composers any caller can open. Entry points
(composer buttons, slash commands, menus) are how composers are reached.
Related: [miniapp-event-api.md](miniapp-event-api.md),
[ai-gateway.md](ai-gateway.md), [miniapp-agent-api.md](miniapp-agent-api.md).

## 1. Decisions

| Question | Decision |
|---|---|
| Unit | A composer: a self-contained input surface carrying every input it needs (text, choices, attachments, parameters) and producing one submission. |
| Slot | The composer slot shows exactly one composer. No stacking of prompts above the chat composer. |
| Default composer | Today's chat composer — one registry entry, not a special case. |
| Decision prompts | Permission and AskUserQuestion replace the default composer in the slot. Plan approval keeps its original full-screen review. Pending decisions are processed one at a time without a queue counter. |
| Reuse | Built-in patterns (image, video, decision prompts) are registered composers any caller can open. |
| Cross-platform | Declarative composers are preferred: the host renders them with native controls on desktop and phone. |

## 2. Current state

| Piece | Where | State |
|---|---|---|
| Composer slot | `ComposerSwitch` plus `composer-slot/resolve-composer.ts` and `composer-registry.tsx` | Registry selects decision, MCP App consent, realtime voice, or text; the slot keeps its hand-off animation and height alignment |
| Decision prompts | `DecisionComposer` (`PermissionPrompt`, `AskUserQuestionPrompt`) and `PlanApprovalPrompt` | Permissions and questions replace the base composer and run one at a time without a counter. Plan approval retains the original full-screen review after those decisions |
| Tool intercepts | `manifest.tools[].renderer.intercept` | WebView input before a mini-app tool runs, rendered in the transcript |
| Media generation | `media_*` MCP tools | Agent-only; no direct user surface |
| Mini window | `apps/desktop/src/renderer/src/components/MiniWindowApp.tsx` | Mounts a full `SessionPane`; it is not session-less today |
| Phone | `apps/mobile/src/navigation/mobile-app.tsx`, `packages/chat-view/src/PortableDecisionCards.tsx`, and `pending-prompt-bar.tsx` | Permission and plan approvals use native sheets and can collapse into the pending-prompt bar; AskUserQuestion renders in the transcript. Phase 1 only changes desktop |

## 3. Composer model

| Dimension | Values | Notes |
|---|---|---|
| Source | `native` / `declarative` / `webview` | Native: chat, voice, image, video, decision prompts. Declarative: fields described by a spec, rendered by the host. WebView: mini-app HTML, like popover templates. |
| Opened by | user / mini-app / widget / agent | Users via mode picker or slash command; apps and widgets via API; agents via a tool or a pending interaction. |
| Lifetime | `once` / `sticky` | `once` returns to the default composer after submit or cancel. `sticky` stays until the user switches (e.g. an image mode). |
| Output | `caller` / `agent` / `session` | See §6. |

```ts
const submission = await composer.open({
  id: 'bug-report',
  fields: [
    { name: 'title', type: 'text' },
    { name: 'severity', type: 'select', options: ['low', 'high'] },
    { name: 'screenshot', type: 'attachment' },
  ],
  submitLabel: 'Report',
  output: 'caller',
  lifetime: 'once',
})

// Built-in composers are opened the same way.
await composer.open('superone.image', { prefill: { prompt } })
```

## 4. Slot and priority

- One composer is visible. Opening a `once` composer pushes it; submit or cancel
  pops back to what was underneath. A `sticky` composer replaces the base.
- HITL composers (permission, question, plan approval) take priority over
  everything else. An app or widget composer never covers them.
- Several pending prompts are answered one by one without a position counter.
  Plan approval retains its original full-screen review (user decision,
  2026-10-05).
- The slot may grow up to a cap for tall content (a form, a diff) so the
  transcript above stays visible. `ComposerSwitch` already owns the height
  hand-off.

## 5. Decision prompts as composers

Each prompt composer carries all its inputs. Permission: allow, deny, deny with
feedback (a text field), stop. AskUserQuestion: options plus an "other" text
field. Plan approval: approve, revise with feedback.

Rules:

1. **Draft preserved.** An unsent draft in the default composer survives the
   replacement and is restored when the prompt resolves.
2. **No misfire.** A prompt that appears while the user is typing does not take
   the pending keystrokes: no auto-focus steal, and a short guard before Enter
   can answer. High-risk approvals (running a command) need an explicit click or
   a dedicated shortcut.
3. **Own session only.** A collaboration child's prompts stay in the child; the
   parent shows at most a notice, not a composer.
4. **App-owned answers.** When a mini-app intercepts an answerable event
   ([miniapp-event-api.md](miniapp-event-api.md) §4.2), it registers its own
   prompt composer in place of the default one.

## 6. Output

| Output | Example | Behavior |
|---|---|---|
| `caller` | A mini-app collecting structured input | Returned to the caller; nothing enters the transcript |
| `agent` | A bug-report form | Rendered into a message with attachments and sent as a normal turn |
| `session` | A quick image inside a session | Runs directly — e.g. `generateImage` through the AI gateway — without an agent turn; the result is recorded in the session (open question 1) |

The image and video composers are UI over the AI gateway: model choice,
routing and metering are the gateway's.

## 7. Hosts

- The session composer slot.
- The mini window, for session-less use; output goes to the caller and the
  media library.
- Mini-app panels, which can embed a built-in composer instead of rebuilding
  it.
- The phone, rendering declarative composers natively in the composer bar.
  WebView composers need a mobile fallback (open question 3).

## 8. Entry points

Contribution points declared in the manifest and rendered by the host: composer
buttons, slash commands, mention sources, message context-menu items and
sidebar entries. Most entry points open a composer, which is why both live in
this proposal.

## 9. Phases

1. Composer registry behind `ComposerSwitch`; decision prompts move into the
   slot as composers. **Delivered for desktop; see the [execution plan](../plans/input-surfaces.md).**
2. Native image and video composers, opened by users (mode picker, slash
   command) with `caller` and `agent` output.
3. Declarative composer API for mini-apps, widgets and agents; phone rendering.
4. WebView composers, absorbing tool intercepts; manifest entry points.

## 10. Open questions

1. `session` output: record user-initiated results as a new event (e.g.
   `user_action`) that enters the agent's context with the next message, show
   them without entering context, or drop `session` and route through the agent.
2. An agent tool for requesting structured input (`composer_request`), and
   whether it supersedes AskUserQuestion across harnesses.
3. WebView composers on the phone: fallback UI or a mobile WebView path.
4. Guard length and shortcut design for the misfire rule.
