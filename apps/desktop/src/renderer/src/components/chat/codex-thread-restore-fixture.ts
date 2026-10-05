import type { ChatMessage, RealtimeTimelineResult } from '@superone/shared/agent-types'

/** A typed steer splits one provider turn; compaction rows exist only locally. */
export function codexThreadRestoreFixture(): { messages: ChatMessage[]; timeline: RealtimeTimelineResult } {
  const row = (id: string, role: ChatMessage['role'], text: string): ChatMessage => ({
    id, role, status: 'complete', providerId: 'codex',
    createdAt: '2026-10-05T03:00:00Z', content: [{ type: 'text', text }],
  })
  const answer = (id: string, turnId: string, text: string): ChatMessage => ({
    ...row(id, 'assistant', text),
    metadata: {
      codex: { threadId: 'thread', turnId, usage: null, items: [{ type: 'agent_message', id: `${turnId}-answer`, text }] },
    },
  })
  const request = row('request', 'user', 'Show the composer changes. 展示输入区改动。')
  const progress = row('progress', 'assistant', 'Checking the approval flow. 正在检查审批流程。')
  const feedback = { ...row('feedback', 'user', 'Keep plan approval fullscreen. 计划审批保留全屏。'), providerId: 'remote' }
  const reply = answer('reply', 'turn-1', 'Plan approval stays fullscreen; the counter is removed. 计划审批保留全屏，计数已移除。')
  const followup = row('followup', 'user', 'Check the remaining tools. 检查其他工具。')
  const final = answer('final', 'turn-2', 'All approval tools are checked. 所有审批工具已检查。')
  const compact = (id: string) => ({ ...row(id, 'assistant', '__compact__:auto:219744::162039'), providerId: 'system' })
  return {
    messages: [request, compact('compact-1'), progress, feedback, reply, followup, compact('compact-2'), final],
    timeline: {
      segments: [], activeRealtimeSessionId: null, hasTimeline: true,
      threadMessages: [
        request,
        { ...feedback, id: 'provider-feedback', providerId: 'codex' },
        { ...reply, id: 'canonical-reply', createdAt: '', metadata: { ...reply.metadata, codexTimeline: { provenance: 'codex', turnId: 'turn-1', position: 1 } } },
        followup,
        { ...final, id: 'canonical-final', createdAt: '', metadata: { ...final.metadata, codexTimeline: { provenance: 'codex', turnId: 'turn-2', position: 2 } } },
      ],
    },
  }
}
