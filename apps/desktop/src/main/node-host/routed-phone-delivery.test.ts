import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import type { SessionLoadResult } from '@superone/shared/environment'
import { ConnectionDelivery, deliveryPolicy } from '@superone/runtime/stream'
import { RoutedPhoneDelivery } from './routed-phone-delivery'

const canonical: ChatMessage = { id: 'voice-task', role: 'assistant', status: 'complete', createdAt: '',
  content: [{ type: 'thinking', thinking: 'canonical backing detail' }] }
function load(version = 1): SessionLoadResult {
  return { sessionId: 's', state: {}, messages: [], before: null,
    cursor: { sequence: String(version), version, epoch: 'epoch' },
    restore: { sourceEnvironmentId: 'source', mcpAppContexts: [], isWorktree: false, worktreePath: null,
      gitBranch: null, worktreeMissing: false, realtimeHasTimeline: true, realtimeThreadMessages: [canonical] },
  }
}

describe('routed voice backing details', () => {
  it('expands canonical backing rows outside the loaded chat page without sending their bodies', () => {
    const views = new RoutedPhoneDelivery(), delivery = new ConnectionDelivery(deliveryPolicy('relay', 'phone'))
    const result = views.load('source', load(), delivery)
    expect(result.restore?.realtimeThreadMessages?.[0].content[0]).toMatchObject({ thinking: '', remoteDetail: '["voice-task","thinking",0]' })
    expect(views.detail('source', { sessionId: 's', subscriptionId: 'detail', detailRef: '["voice-task","thinking",0]' }, delivery).text).toBe('canonical backing detail')
    expect(canonical.content[0]).toMatchObject({ thinking: 'canonical backing detail' })
    expect(() => views.detail('other', { sessionId: 's', subscriptionId: 'other', detailRef: '["voice-task","thinking",0]' }, delivery)).toThrow('Detail not found')
  })
  it('retains backing rows through paging and replaces them with the next authoritative restore', () => {
    const views = new RoutedPhoneDelivery(), delivery = new ConnectionDelivery(deliveryPolicy('relay', 'phone'))
    views.load('source', load(), delivery)
    const page = { ...load(), restore: undefined }
    views.load('source', page, delivery, false)
    const input = { sessionId: 's', subscriptionId: 'detail', detailRef: '["voice-task","thinking",0]' }
    expect(views.detail('source', input, delivery).text).toBe('canonical backing detail')
    const latest = load(2)
    latest.restore!.realtimeThreadMessages = []
    views.load('source', latest, delivery)
    expect(() => views.detail('source', input, delivery)).toThrow('Detail not found')
  })
})
