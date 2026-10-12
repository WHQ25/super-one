import { describe, expect, it } from 'vitest'
import type { AgentEvent, ChatMessage } from '@superone/shared/agent-types'
import { createDefaultChatCoreSession } from './defaults'
import { applyEventToSession } from './reducer'

function fixture() {
  let session = createDefaultChatCoreSession()
  const message: ChatMessage = { id: 'm', role: 'assistant', providerId: 'codex', status: 'streaming', createdAt: '', content: [{ type: 'text', text: 'existing' }] }
  session.messages = [message]
  return { apply(event: AgentEvent) { session = { ...session, ...applyEventToSession(session, event) }; return session }, get: () => session }
}
const started = { id: 'a', sourceThreadId: 'root', sourceTurnId: 't', agentThreadId: 'child', agentPath: 'root/child', kind: 'started' as const, model: 'actual', reasoningEffort: 'high' }

describe('Codex metadata reduction', () => {
  it('stores activities without changing visible content or tool items', () => {
    const f = fixture(), content = f.get().messages[0].content
    f.apply({ type: 'codex_subagent_activity', messageId: 'm', activity: started })
    f.apply({ type: 'codex_subagent_activity', messageId: 'm', activity: { ...started, model: undefined, reasoningEffort: undefined } })
    f.apply({ type: 'codex_subagent_activity', messageId: 'm', activity: { id: 'done', sourceThreadId: 'root', agentThreadId: 'child', agentPath: 'root/child', kind: 'completed' } })
    const message = f.get().messages[0]
    expect(message.content).toBe(content)
    expect(message.metadata?.codex?.items).toEqual([])
    expect(message.metadata?.codex?.subagents?.child.creationConfiguration).toEqual({ model: 'actual', reasoningEffort: 'high' })
    expect(message.metadata?.codex?.subagents?.child.activities).toHaveLength(2)
  })

  it('keeps partial values and sibling configuration independent', () => {
    const f = fixture()
    f.apply({ type: 'codex_subagent_activity', messageId: 'm', activity: { ...started, reasoningEffort: undefined } })
    f.apply({ type: 'codex_subagent_activity', messageId: 'm', activity: { ...started, id: 'b', agentThreadId: 'sibling', model: 'other', reasoningEffort: 'low' } })
    expect(f.get().messages[0].metadata?.codex?.subagents?.child.creationConfiguration).toEqual({ model: 'actual' })
    expect(f.get().messages[0].metadata?.codex?.subagents?.sibling.creationConfiguration).toEqual({ model: 'other', reasoningEffort: 'low' })
  })

  it('preserves live metadata on completion, serialization and replay', () => {
    const f = fixture()
    f.apply({ type: 'codex_turn_metadata', messageId: 'm', provenance: { threadId: 'root', turnId: 't', rootTurnId: 'origin' }, requestedProvenance: { parentTurnId: 'parent' } })
    f.apply({ type: 'codex_subagent_activity', messageId: 'm', activity: started })
    const complete: AgentEvent = { type: 'message_complete', messageId: 'm', metadata: { codex: { threadId: 'root', turnId: 't', usage: null, items: [] } } }
    f.apply(complete)
    f.apply({ ...complete, metadata: { codex: { threadId: 'root', turnId: 't', rootTurnId: null, usage: null, items: [], subagents: { sibling: { activities: [] } } } } })
    const message = JSON.parse(JSON.stringify(f.get().messages[0])) as ChatMessage
    expect(message.metadata?.codex).toMatchObject({ turnId: 't', rootTurnId: 'origin', requestedProvenance: { parentTurnId: 'parent' }, subagents: { child: { creationConfiguration: { model: 'actual', reasoningEffort: 'high' } } } })
    expect(message.status).toBe('complete')
    f.apply({ type: 'codex_subagent_activity', messageId: 'm', activity: started })
    expect(f.get().messages[0].metadata?.codex?.subagents?.child.activities).toHaveLength(1)
  })

  it('does not carry a root or request attribution into a different turn', () => {
    const f = fixture()
    f.apply({ type: 'codex_turn_metadata', messageId: 'm', provenance: { threadId: 'root', turnId: 't', rootTurnId: 'origin' }, requestedProvenance: { parentTurnId: 'parent' } })
    f.apply({ type: 'codex_turn_metadata', messageId: 'm', provenance: { threadId: 'root', turnId: 't', rootTurnId: null } })
    expect(f.get().messages[0].metadata?.codex?.rootTurnId).toBe('origin')
    f.apply({ type: 'codex_turn_metadata', messageId: 'm', provenance: { threadId: 'root', turnId: 'next' } })
    expect(f.get().messages[0].metadata?.codex?.rootTurnId).toBeUndefined()
    expect(f.get().messages[0].metadata?.codex?.requestedProvenance).toBeUndefined()
  })

  it('rejects stale replay and unrelated message targets', () => {
    const f = fixture()
    f.apply({ type: 'codex_subagent_activity', messageId: 'm', activity: started, epoch: 1, seq: 5 })
    f.apply({ type: 'codex_subagent_activity', messageId: 'm', activity: { ...started, model: 'stale' }, epoch: 1, seq: 4 })
    f.apply({ type: 'codex_subagent_activity', messageId: 'other', activity: { ...started, model: 'unrelated' } })
    expect(f.get().messages[0].metadata?.codex?.subagents?.child.creationConfiguration?.model).toBe('actual')
  })

  it('does not reuse an earlier root when only a different turn completion is replayed', () => {
    const f = fixture()
    f.apply({ type: 'codex_turn_metadata', messageId: 'm', provenance: { threadId: 'root', turnId: 't', rootTurnId: 'origin' }, requestedProvenance: { parentTurnId: 'parent' } })
    f.apply({ type: 'message_complete', messageId: 'm', metadata: { codex: { threadId: 'root', turnId: 'next', usage: null, items: [] } } })
    expect(f.get().messages[0].metadata?.codex?.rootTurnId).toBeUndefined()
    expect(f.get().messages[0].metadata?.codex?.requestedProvenance).toBeUndefined()
  })
})
