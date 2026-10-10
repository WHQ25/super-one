import { describe, expect, it, vi } from 'vitest'

vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }))
vi.mock('../environment/session-identity', () => ({ localSessionEnvironmentId: () => 'env-local' }))

import type { AgentEvent, TerminalEvent } from '@superone/shared/agent-types'
import { deliveryPolicy } from '@superone/runtime/stream'
import { createDesktopTopicHub, publishHubEvent, topicOfHubEvent, topicOfTerminalEvent, type DesktopTopicItem } from './desktop-topics'
import { RendererInterest } from './renderer-interest'
import { LocalTopicRecovery } from './topic-recovery'
import type { Session } from '../session/types'

const LOCAL = 'env-local'

function rendererOf(topics: ReturnType<typeof createDesktopTopicHub>) {
  const items: DesktopTopicItem[] = []
  const interest = new RendererInterest(topics.open({ id: 'renderer', policy: deliveryPolicy('ipc', 'desktop'), sink: { deliver: (_t, item) => { items.push(item) } } }), LOCAL)
  return { items, interest, types: () => items.map((item) => item.event.type) }
}

describe('desktop topics', () => {
  it('maps each hub event to the one topic it belongs to', () => {
    expect(topicOfHubEvent({ event: { type: 'status_change', status: 'idle', sessionId: 's1' }, source: 'session', sessionId: 's1' }, LOCAL))
      .toEqual({ kind: 'session', environmentId: LOCAL, sessionId: 's1' })
    expect(topicOfHubEvent({ event: { type: 'status_change', status: 'idle', sessionId: 'n1', projectPath: 'remote:node-b:/repo' }, source: 'remote-node' }, LOCAL))
      .toEqual({ kind: 'session', environmentId: 'node-b', sessionId: 'n1' })
    expect(topicOfHubEvent({ event: { type: 'session_list_changed', projectPath: '/p' }, source: 'list' }, LOCAL)).toEqual({ kind: 'sessionList', environmentId: LOCAL })
    expect(topicOfHubEvent({ event: { type: 'project_list_changed' }, source: 'list' }, LOCAL)).toEqual({ kind: 'projects', environmentId: LOCAL })
    expect(topicOfHubEvent({ event: { type: 'draft_changed', draftId: 'd', draft: null, reason: 'deleted' } as AgentEvent, source: 'draft' }, LOCAL)).toEqual({ kind: 'drafts', environmentId: LOCAL })
    expect(topicOfHubEvent({ event: { type: 'provider_changed' } as AgentEvent, source: 'environment' }, LOCAL)).toEqual({ kind: 'environment', environmentId: LOCAL })
  })

  it('maps terminal output to its terminal and list metadata to the terminal list', () => {
    const output = { type: 'terminal_output', terminalId: 'remote-terminal:node-b:t9', data: 'x', fromSeq: 1, toSeq: 1, createdAt: 0 } as TerminalEvent
    expect(topicOfTerminalEvent(output, LOCAL)).toEqual({ kind: 'terminal', environmentId: 'node-b', terminalId: 't9' })
    expect(topicOfTerminalEvent({ type: 'terminal_title_changed', terminalId: 't1', title: 'vim' }, LOCAL)).toEqual({ kind: 'terminalList', environmentId: LOCAL })
    expect(topicOfTerminalEvent({ type: 'terminal_command_result', requestId: 'r', ok: true }, LOCAL)).toBeNull()
  })

  it('gives the renderer every local session and the remote sessions it follows, not the lists', () => {
    const topics = createDesktopTopicHub()
    const renderer = rendererOf(topics)
    const context = { localEnvironmentId: LOCAL, getSession: () => null, spawnParentOf: () => null }
    publishHubEvent(topics, { event: { type: 'status_change', status: 'idle', sessionId: 'any' }, source: 'session', sessionId: 'any' }, context)
    publishHubEvent(topics, { event: { type: 'session_list_changed', projectPath: '/p' }, source: 'list' }, context)
    const remote: AgentEvent = { type: 'message_complete', messageId: 'm', sessionId: 'n1', projectPath: 'remote:node-b:/repo' } as AgentEvent
    publishHubEvent(topics, { event: remote, source: 'remote-node' }, context)
    renderer.interest.follow({ environmentId: 'node-b', sessionId: 'n1' }, true)
    publishHubEvent(topics, { event: remote, source: 'remote-node' }, context)
    renderer.interest.follow({ environmentId: 'node-b', sessionId: 'n1' }, false)
    publishHubEvent(topics, { event: remote, source: 'remote-node' }, context)
    expect(renderer.types()).toEqual(['status_change', 'message_complete'])
  })

  it('publishes a session\'s summary to the session list before the event, and versions list changes', () => {
    const topics = createDesktopTopicHub()
    const seen: string[] = []
    topics.open({ id: 'phone', policy: deliveryPolicy('relay', 'phone'), sink: { deliver: (topic, item) => { seen.push(`${topic.kind}:${item.event.type}`) } } })
      .replace('sessionList', [{ kind: 'sessionList', environmentId: LOCAL }])
    const session = { id: 's1', ephemeral: false, snapshot: { id: 's1', projectPath: '/p', harnessId: 'claude', messages: [] }, activityStatus: () => 'streaming', realtimeActive: false, getPendingInteractions: () => [] } as unknown as Session
    const recovery = new LocalTopicRecovery(LOCAL, () => null)
    const list = { kind: 'sessionList', environmentId: LOCAL } as const
    const before = recovery.cursor(list)
    publishHubEvent(topics, { event: { type: 'status_change', status: 'streaming', sessionId: 's1' }, source: 'session', sessionId: 's1' }, {
      localEnvironmentId: LOCAL, recovery, getSession: () => session, spawnParentOf: () => null,
    })
    expect(seen).toEqual(['sessionList:session_activity'])
    expect(recovery.recover(list, before)).toMatchObject({ kind: 'replay', items: [{ type: 'session_activity' }] })
  })
})
