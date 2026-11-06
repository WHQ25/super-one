/** @vitest-environment jsdom */
import { renderHook, act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { PinnedSessionEntry } from '@superone/shared/agent-types'
import { focusEnvironments, focusLocal, focusRemote, focusFork } from './project-focus.fixtures'
import {
  draftScopeForFocus,
  pinnedSessionsForFocus,
  useFocusContextCollapsed,
} from './sidebar-focus-context'

function pin(sessionId: string, folderPath: string): PinnedSessionEntry {
  return { sessionId, folderPath, folderName: folderPath, title: sessionId } as PinnedSessionEntry
}

const environments = [
  { environmentId: 'env-local', connectionId: 'local', connection: 'connected' },
  { environmentId: 'env-remote', connectionId: 'node-1', connection: 'offline' },
]

describe('focus context lists', () => {
  const sessions = [
    pin('local-a', '/pay'),
    pin('local-b', '/bill'),
    pin('remote-a', 'remote:node-1:/pay'),
  ]

  it('keeps one project’s pins and that project’s drafts', () => {
    const focus = { kind: 'project' as const, folderPath: '/pay', environmentId: 'env-local' }
    expect(pinnedSessionsForFocus(sessions, focus, environments).map((item) => item.sessionId)).toEqual(['local-a'])
    expect(draftScopeForFocus(focus, environments)).toEqual({
      connectionIds: ['local'],
      projectKey: '/pay',
      offlineConnectionIds: [],
    })
  })

  it('includes pins and drafts from all same-origin checkouts, excluding forks', () => {
    const focus = { kind: 'project' as const, folderPath: focusLocal.pathKey, environmentId: focusLocal.environmentId }
    const pins = [pin('here', focusLocal.pathKey), pin('there', focusRemote.pathKey), pin('fork', focusFork.pathKey)]
    expect(pinnedSessionsForFocus(pins, focus, focusEnvironments).map((item) => item.sessionId)).toEqual(['here', 'there'])
    expect(draftScopeForFocus(focus, focusEnvironments)).toEqual({
      connectionIds: ['local', 'node-1'],
      projectKeys: [focusLocal.pathKey, focusRemote.pathKey],
      offlineConnectionIds: [],
    })
  })

  it('keeps every pin and draft on the focused environment', () => {
    const focus = { kind: 'environment' as const, environmentId: 'env-remote' }
    expect(pinnedSessionsForFocus(sessions, focus, environments).map((item) => item.sessionId)).toEqual(['remote-a'])
    expect(draftScopeForFocus(focus, environments)).toEqual({
      connectionIds: ['node-1'],
      offlineConnectionIds: ['node-1'],
    })
  })

  it('hides both groups while a session is focused', () => {
    const focus = { kind: 'session' as const, folderPath: '/pay', sessionId: 'parent', environmentId: null }
    expect(pinnedSessionsForFocus(sessions, focus, environments)).toEqual([])
    expect(draftScopeForFocus(focus, environments)).toBeNull()
  })

  it('starts folded and folds again when the focused object changes', () => {
    const hook = renderHook(({ key }) => useFocusContextCollapsed(key), { initialProps: { key: 'project:/pay' } })
    expect(hook.result.current.pinned).toBe(true)
    act(() => hook.result.current.togglePinned())
    expect(hook.result.current.pinned).toBe(false)
    hook.rerender({ key: 'project:/bill' })
    expect(hook.result.current.pinned).toBe(true)
  })
})
