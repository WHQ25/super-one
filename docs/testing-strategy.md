# Session & Conversation State Testing Strategy

## Problem

Current tests (250 total) are mostly stateless unit tests. Bugs in conversation state management — like the slash command bug where `turnMessageId` wasn't synced, causing previous assistant messages to be deleted — are invisible to them.

The core issue: the chat system is a **state machine** where bugs emerge from step combinations, not individual steps.

## Current Coverage Gaps

| Source File | Lines | Test Lines | Gap |
|---|---|---|---|
| `stores/chat.ts` | 2283 | 743 | `applyEventToSession` (the core state reducer) is barely tested |
| `agent/claude-query.ts` | 804 | 629 | No multi-turn scenarios, no slash command flows |
| `agent/claude-agent.ts` | 575 | 0 | No tests at all |

## Architecture: SessionHarness

Anchor tests on `applyEventToSession` — a **pure function** `(session, event) → Partial<PerSessionState>`. No mocks needed, no IPC dependencies, fast execution.

### Core Components

```
src/test-utils/
├── session-harness.ts    — SessionHarness class (apply events, chain assertions)
├── event-factories.ts    — msg.start(), msg.delta(), msg.complete(), etc.
└── fixtures/             — JSON event sequences exported from event-trace.db
```

### SessionHarness API

```typescript
class SessionHarness {
  session: PerSessionState

  constructor(initial?: Partial<PerSessionState>)

  // Apply single event, returns `this` for chaining
  apply(event: AgentEvent): this

  // Apply multiple events in order
  applyAll(events: AgentEvent[]): this

  // Convenience: simulate a complete conversation turn
  simulateTurn(userText: string, assistantId: string, assistantBlocks: ContentBlock[]): this

  // Convenience: simulate a slash command flow
  simulateSlashCommand(command: string, messageId: string, content: string): this

  // Debug snapshot
  snapshot(): { messageCount, roles, status, slashCommandOutput }
}
```

### Event Factories

```typescript
const msg = {
  start(id: string): AgentEvent
  textDelta(messageId: string, text: string): AgentEvent
  toolUse(messageId: string, toolName: string, input: string): AgentEvent
  toolResult(messageId: string, toolUseId: string, summary: string): AgentEvent
  complete(messageId: string): AgentEvent
  slashOutput(messageId: string, content: string): AgentEvent
  permission(messageId: string, toolName: string): AgentEvent
  interrupt(messageId: string): AgentEvent
  error(messageId: string, errorText: string): AgentEvent
}
```

### Test Style

Story-style tests — each `it` block is a complete scenario:

```typescript
it('slash command after one turn preserves previous response', () => {
  const h = new SessionHarness()
    .simulateTurn('hello', 'msg_1', [{ type: 'text', text: 'Hi!' }])

  expect(h.session.messages).toHaveLength(2)

  h.simulateSlashCommand('context', 'msg_2', 'token usage...')

  expect(h.session.messages).toHaveLength(2) // user1 + assistant1 preserved
  expect(h.session.slashCommandOutput?.command).toBe('context')
})
```

For bug regressions, title with issue reference:

```typescript
it('BUG: slash_command_output with stale messageId should not delete previous assistant', () => {
  // Reproduce exact conditions of the bug
})
```

## Priority Scenarios (Phase 1)

### P0 — Known Bug Patterns

1. **Slash command after conversation** — `slash_command_output` with stale/wrong `messageId`
2. **Subagent message routing** — content_delta routed to wrong messageId during background tasks (commit 44657d9)
3. **Interrupt mid-stream** — message status, partial content preservation

### P1 — Complex State Transitions

4. **Multi-turn conversation** — 3+ turns, verify all messages accumulate correctly
5. **Permission request flow** — request → respond → resume, message state through each step
6. **Plan mode** — enter plan → file tracking → exit plan, state transitions
7. **Compacting** — `status_indicator: compacting` → messages replaced

### P2 — Session Lifecycle

8. **Session switch** — project A streaming → switch to B → switch back, messages intact
9. **Background session** — park → background events continue → resume to foreground
10. **Session resume from history** — load from DB → continue conversation

## Phase 2: Query Scenario Tests

After the harness is stable, add tests for `iterateMessages` in `claude-query.test.ts`:

- Verify `AgentEvent` sequences produced from SDK message sequences
- Focus on `messageId` correctness across turns
- Test `turnMessageId` sync for slash commands, background tasks, subagents

## Leveraging event-trace.db

Export real event sequences from dev sessions as test fixtures:

```bash
# Export events for a specific session
sqlite3 event-trace.db \
  "SELECT json_object('type', type, 'data', data, 'tag', tag) FROM events WHERE source='agent.emit' ORDER BY id" \
  > src/test-utils/fixtures/real-session.json
```

Use in tests via `harness.applyAll(require('./fixtures/real-session.json'))`.

Useful for reproducing user-reported bugs when event-trace is available.
