/** @vitest-environment jsdom */
/**
 * Regression for resuming a completed sub-agent via the SendMessage tool.
 *
 * Trace-verified SDK behavior (event-trace.db, task_id acc51a2…, original Agent
 * toolUseId 2risVnrC): on resume the SDK emits a fresh `init`, streams the
 * resumed output into a NEW assistant message (different messageId) tagged with
 * the ORIGINAL Agent toolUseId as parentToolUseId, sends NO new task_started,
 * and closes with a task_notification whose tool_use_id is the SendMessage
 * tool's id — only the shared task_id links it back to the Agent block.
 *
 * Two bugs follow: (1) the per-message grouping cannot reunite the orphan child
 * with its Agent block in an earlier message → the content leaks into the main
 * conversation; (2) taskProgress[origId].completed stays true (no task_started
 * resets it; the closing notification lands on a phantom key) → the panel hides
 * the now-running agent.
 */
import { describe, it, expect, vi } from 'vitest'
import type { AgentEvent, ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import { groupContent } from '@/components/chat/ChatMessage'
import { collectBackgroundActivities } from '@/components/chat/ChatStatusBar'
import { applyEventToSession } from '@/stores/chat-store/event-reducer'
import { createDefaultPerSessionState } from '@/stores/chat-store'

vi.stubGlobal('window', {
  agent: new Proxy({}, { get: () => () => Promise.resolve(undefined) }),
  app: { trace: vi.fn(), getAppSettings: vi.fn().mockResolvedValue({ agentPreference: {} }) },
})

const MA = 'msg-A'
const MB = 'msg-B'
const ORIG = 'tu-orig-agent'
const TASK = 'task-1'
const SENDMSG = 'tu-sendmessage'

function apply(session: ReturnType<typeof createDefaultPerSessionState>, event: AgentEvent) {
  return { ...session, ...applyEventToSession(session, event) }
}

function startMsg(id: string): AgentEvent {
  return { type: 'message_start', message: { id, role: 'assistant', status: 'streaming', content: [], createdAt: '', providerId: 'claude' } as ChatMessage } as AgentEvent
}
function delta(messageId: string, d: ContentBlock): AgentEvent {
  return { type: 'content_delta', messageId, delta: d } as AgentEvent
}
const agentBlock = (toolUseId: string): ContentBlock => ({ type: 'tool_use', toolName: 'Agent', toolUseId, input: '{"description":"analyze hello_world.py"}', parentToolUseId: null } as ContentBlock)
const text = (t: string, parent: string | null): ContentBlock => ({ type: 'text', text: t, parentToolUseId: parent } as ContentBlock)

function msg(session: ReturnType<typeof createDefaultPerSessionState>, id: string): ChatMessage {
  return session.messages.find((m) => m.id === id)!
}
function topLevelLeak(content: ContentBlock[], parentId: string): boolean {
  const { segments } = groupContent(content, [])
  for (const seg of segments as Array<Record<string, unknown>>) {
    const blocks: ContentBlock[] =
      seg.kind === 'block' ? [seg.block as ContentBlock]
      : (seg.kind === 'tools' || seg.kind === 'thinking' || seg.kind === 'app-tools') ? (seg.blocks as ContentBlock[])
      : []
    if (blocks.some((b) => 'parentToolUseId' in b && b.parentToolUseId === parentId)) return true
  }
  return false
}

describe('resuming a completed sub-agent via SendMessage', () => {
  // First run: Agent block + nested output in message A, then completes.
  function firstRun() {
    let s = createDefaultPerSessionState()
    s = apply(s, startMsg(MA))
    s = apply(s, delta(MA, agentBlock(ORIG)))
    s = apply(s, { type: 'task_started', taskId: TASK, toolUseId: ORIG, description: 'analyze hello_world.py' } as AgentEvent)
    s = apply(s, delta(MA, text('Initial analysis: 9 functions.', ORIG)))
    s = apply(s, { type: 'task_notification', taskId: TASK, toolUseId: ORIG, taskStatus: 'completed', outputFile: '' } as AgentEvent)
    return s
  }

  it('marks the sub-agent completed after the first run', () => {
    const s = firstRun()
    expect(s.taskProgress[ORIG].completed).toBe(true)
  })

  it('re-marks the sub-agent running when resumed content arrives in a new message', () => {
    let s = firstRun()
    // Resume: new assistant message with main content + the resumed sub-agent output.
    s = apply(s, startMsg(MB))
    s = apply(s, delta(MB, text('main summary', null)))
    s = apply(s, delta(MB, text('RESUMED-OUTPUT detailed function descriptions', ORIG)))
    expect(s.taskProgress[ORIG].completed).toBe(false)
  })

  it('routes the resumed sub-agent output under its Agent block, not into main chat', () => {
    let s = firstRun()
    s = apply(s, startMsg(MB))
    s = apply(s, delta(MB, text('main summary', null)))
    s = apply(s, delta(MB, text('RESUMED-OUTPUT detailed function descriptions', ORIG)))

    // The resumed child must NOT leak to the top level of the new message.
    expect(topLevelLeak(msg(s, MB).content, ORIG)).toBe(false)
    // It must be re-homed under the original Agent block's message (merged into
    // the sub-agent's existing text run there).
    const homed = msg(s, MA).content.some((b) => b.type === 'text' && b.text.includes('RESUMED-OUTPUT') && 'parentToolUseId' in b && b.parentToolUseId === ORIG)
    expect(homed).toBe(true)
    const stillInMB = msg(s, MB).content.some((b) => b.type === 'text' && b.text.includes('RESUMED-OUTPUT'))
    expect(stillInMB).toBe(false)
  })

  it('closes out the original Agent block when the resume notification carries the SendMessage toolUseId', () => {
    let s = firstRun()
    s = apply(s, startMsg(MB))
    s = apply(s, delta(MB, text('main summary', null)))
    s = apply(s, delta(MB, text('RESUMED-OUTPUT', ORIG)))
    // Resume's task_notification: different toolUseId, same task_id.
    s = apply(s, { type: 'task_notification', taskId: TASK, toolUseId: SENDMSG, taskStatus: 'completed', outputFile: '' } as AgentEvent)
    expect(s.taskProgress[ORIG].completed).toBe(true)
    expect(s.taskProgress[SENDMSG]).toBeUndefined()
  })

  it('shows the agent as a running background activity while the resume streams', () => {
    let s = firstRun()
    s = apply(s, startMsg(MB))
    s = apply(s, delta(MB, text('RESUMED-OUTPUT', ORIG)))
    const { agentActivities } = collectBackgroundActivities(s.messages, s.taskProgress, false)
    expect(agentActivities.map((a) => a.id)).toContain(ORIG)
  })
})
