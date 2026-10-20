import { describe, expect, it } from 'vitest'
import type { DesktopSessionRow } from '../db-remote-controlled-sessions'
import { createDefaultChatCoreSession } from '@superone/chat-core'
import { attachAcpModelCatalog, DesktopSessionReads, pageSessionRows } from './desktop-session-reads'

function row(sessionId: string, parentSessionId?: string): DesktopSessionRow {
  return {
    sessionId,
    projectId: 'p1',
    projectPath: '/work/app',
    title: sessionId,
    harnessId: 'claude',
    providerId: 'claude',
    providerSessionId: null,
    worktreePath: null,
    isPinned: false,
    isHidden: false,
    isUserRenamed: false,
    tags: [],
    createdAt: 0,
    updatedAt: 0,
    controller: null,
    ...(parentSessionId ? { parentSessionId } : {}),
  }
}

class Reads extends DesktopSessionReads<DesktopSessionRow> {}

const family = [
  row('a'),
  row('b'),
  row('parent'),
  row('child', 'parent'),
  row('child-2', 'parent'),
  row('c'),
]

describe('attachAcpModelCatalog', () => {
  it('names a cold ACP session from the host catalog and leaves a replayed catalog alone', () => {
    const cold = createDefaultChatCoreSession()
    const named = attachAcpModelCatalog(cold, 'grok-build', () => ({
      models: [{ id: 'grok-4.5', name: 'Grok 4.5', description: '' }],
      configId: 'model',
    }))
    expect(named.acpModels).toEqual([{ id: 'grok-4.5', name: 'Grok 4.5', description: '' }])
    expect(named.acpModelsStatus).toBe('ready')
    const replayed = { ...cold, acpModels: [{ id: 'grok-4.5', name: 'From replay', description: '' }], acpModelsStatus: 'ready' as const }
    expect(attachAcpModelCatalog(replayed, 'grok-build', () => ({ models: [{ id: 'x', name: 'Other', description: '' }], configId: null })).acpModels[0]?.name).toBe('From replay')
    expect(attachAcpModelCatalog(cold, null, () => ({ models: [{ id: 'x', name: 'Other', description: '' }], configId: null }))).toBe(cold)
  })
})

describe('pageSessionRows', () => {
  it('keeps a spawn family together when the limit falls inside it', () => {
    const page = pageSessionRows(family, 0, 3)
    expect(page.map((entry) => entry.sessionId)).toEqual(['a', 'b', 'parent', 'child', 'child-2'])
    expect(pageSessionRows(family, page.length, 3).map((entry) => entry.sessionId)).toEqual(['c'])
  })

  it('keeps a page that already ends on a family boundary at the limit', () => {
    expect(pageSessionRows([row('a'), row('b'), row('c')], 0, 2).map((entry) => entry.sessionId)).toEqual(['a', 'b'])
  })
})

describe('DesktopSessionReads.list', () => {
  it('returns a child on the same page as its parent', () => {
    const reads = new Reads({
      environmentId: 'desktop',
      sessions: { getSession: () => null, onSession: () => () => {} } as never,
      rows: {
        get: () => null,
        list: () => family,
        loadMessages: () => ({ messages: [], cursor: null, hasMore: false }),
      },
      events: {} as never,
    })
    const page = reads.list('p1', { limit: 3, offset: 0 })
    expect(page.map((entry) => entry.sessionId)).toEqual(['a', 'b', 'parent', 'child', 'child-2'])
    expect(page.find((entry) => entry.sessionId === 'child')?.parentSessionId).toBe('parent')
  })

  it('serves the row harness and the session ACP agent', () => {
    const cursor = { ...row('cursor-1'), harnessId: 'cursor' as const, providerId: 'cursor-base' }
    const cold = { ...row('cold-grok'), harnessId: 'acp' as const, acpAgentId: 'grok-build' }
    const liveRow = { ...row('live-grok'), harnessId: 'acp' as const, acpAgentId: 'stored' }
    const reads = new Reads({
      environmentId: 'desktop',
      sessions: {
        getSession: (id: string) => id === 'live-grok'
          ? {
              snapshot: { acpAgentId: 'grok-live' },
              cwd: null,
              activityStatus: () => 'idle',
              getPendingInteractions: () => [],
              getCurrentPermissionMode: () => null,
              getCurrentSandboxInfo: () => ({ enabled: false, autoAllowBash: false }),
              getSelectedModel: () => null,
              getSelectedEffort: () => null,
              getApiProviderId: () => null,
              getUiSettings: () => ({ selectedAcpModeId: null }),
              getAgentPreset: () => null,
              getCallerScopedDirsSnapshot: () => null,
            }
          : null,
        onSession: () => () => {},
      } as never,
      rows: {
        get: () => null,
        list: () => [cursor, cold, liveRow],
        loadMessages: () => ({ messages: [], cursor: null, hasMore: false }),
      },
      events: {} as never,
    })
    const page = reads.list('p1')
    expect(page.find((entry) => entry.sessionId === 'cursor-1')).toMatchObject({ harnessId: 'cursor', acpAgentId: null })
    expect(page.find((entry) => entry.sessionId === 'cold-grok')?.acpAgentId).toBe('grok-build')
    expect(page.find((entry) => entry.sessionId === 'live-grok')?.acpAgentId).toBe('grok-live')
  })
})
