import type { ChatMessage, RealtimeTimelineResult } from '@superone/shared/agent-types'
import { codexAsyncAnswerId } from '@superone/shared/codex-async-question'

const row = (id: string, role: ChatMessage['role'], text: string): ChatMessage => ({
  id, role, status: 'complete', providerId: 'codex',
  createdAt: '2026-10-05T03:00:00Z', content: [{ type: 'text', text }],
})

/** A typed steer splits one provider turn; compaction rows exist only locally. */
export function codexThreadRestoreFixture(): { messages: ChatMessage[]; timeline: RealtimeTimelineResult } {
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

/** A steered async reply has a provider id and precedes the source turn in its timeline. */
export function codexAsyncAnswerRestoreFixture(): { messages: ChatMessage[]; timeline: RealtimeTimelineResult } {
  const questions = [{
    title: 'Keep only the mobile layout and restore the original animations? 仅保留移动端布局，恢复原来的动画？',
    options: ['Yes, keep only the mobile layout. 对，仅保留移动端布局。', 'Keep both layouts. 保留双端布局。'],
  }]
  const replyText = questions[0].options[0]
  const request = row('request', 'user', 'Restore the original voice visuals. 恢复原来的语音效果。')
  const work: ChatMessage = {
    ...row('local-turn', 'assistant', 'Restored the original animations and kept the mobile layout. 已恢复原来的动画，保留移动端布局。'),
    metadata: { codex: { threadId: 'thread', turnId: 'turn', usage: null, items: [
      { type: 'agent_message', id: 'question', text: questions[0].title, delivery: 'async', questions },
      { type: 'agent_message', id: 'done', text: 'Restored the original animations and kept the mobile layout. 已恢复原来的动画，保留移动端布局。' },
    ] } },
  }
  const reply: ChatMessage = {
    ...row(codexAsyncAnswerId('question'), 'user', replyText),
    content: [{ type: 'text', text: replyText, codexAsyncQuestions: questions }],
  }
  return {
    messages: [request, work, reply],
    timeline: {
      segments: [], activeRealtimeSessionId: null, hasTimeline: true,
      threadMessages: [request,
        { ...row('provider-answer', 'user', replyText), metadata: { codexTimeline: { provenance: 'codex', turnId: 'turn', position: 1 } } },
        { ...work, id: 'provider-turn' }],
    },
  }
}

/** Legacy provider caches contain host wakes without source metadata. */
export function codexHostWakeRestoreFixture(): { messages: ChatMessage[]; timeline: RealtimeTimelineResult } {
  const request = row('request', 'user', 'Review the implementation. 审核实现。')
  const prompt = 'A collaboration mailbox message is ready. Call session_collab_retrieve.'
  const pasted = row('pasted-notification', 'user', prompt)
  const reply = row('reply', 'assistant', 'The review is complete. 审核已完成。')
  return {
    messages: [request, pasted, reply],
    timeline: {
      segments: [], activeRealtimeSessionId: null, hasTimeline: true,
      threadMessages: [request,
        ...['collab-message:message', 'collab-link:grant', 'collab-stop:child:stop'].map((id, index) => ({
          ...row(id, 'user', prompt),
          metadata: { codexTimeline: { provenance: 'codex' as const, turnId: 'turn', position: index + 1 } },
        })),
        pasted, reply],
    },
  }
}
