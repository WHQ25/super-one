/** @vitest-environment jsdom */
import { act, render, screen, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import { chatState, mockEnvironment, mockWindowApp, notifyChat, sessionFixtures } from './AppSidebar.test-setup'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function registerChild() {
  const project = chatState.projectSessions['/project-a'] as {
    _sessions: Record<string, Record<string, unknown>>
  }
  project._sessions.child = {
    ...project._sessions['sid-1'],
    _title: 'New child',
    _historyHydrated: true,
    _parentSessionId: 'sid-1',
    status: 'streaming',
    messages: [{
      role: 'user', content: [{ type: 'text', text: 'Review the code' }],
      metadata: {
        source: 'collaboration',
        collaboration: { kind: 'initial_task', direction: 'inbound', fromSessionId: 'sid-1' },
      },
    }],
  }
  sessionFixtures.byFolder['/project-a'].push({
    sessionId: 'child', title: 'New child', lastActiveAt: '2026-03-02T00:00:01.000Z',
    messageCount: 1, parentSessionId: 'sid-1',
  })
}

it('reloads after creation invalidates an in-flight list, coalescing repeated notifications', async () => {
  const { AppSidebar } = await import('./AppSidebar')
  let changed!: () => void
  mockWindowApp.onSessionChanged.mockImplementation((callback) => {
    changed = callback
    return () => {}
  })
  render(<AppSidebar />)
  await screen.findByText('Old Session')
  const baseline = mockEnvironment.listSessions.mock.calls.length
  const oldRows = [...sessionFixtures.byFolder['/project-a']]
  const stale = deferred<typeof oldRows>()
  mockEnvironment.listSessions.mockImplementationOnce(() => stale.promise)
  await act(async () => changed())
  await waitFor(() => expect(mockEnvironment.listSessions).toHaveBeenCalledTimes(baseline + 1))

  registerChild()
  await act(async () => { changed(); changed(); notifyChat() })
  await act(async () => stale.resolve(oldRows))

  await waitFor(() => expect(mockEnvironment.listSessions).toHaveBeenCalledTimes(baseline + 2))
  const childRow = await screen.findByText('New child')
  const row = childRow.closest('.group\\/session')!
  expect(row).not.toBeNull()
  expect(row.querySelector('.lucide-corner-down-right')).not.toBeNull()
})

it('waits for the authoritative relationship before showing a live collaboration session', async () => {
  const { AppSidebar } = await import('./AppSidebar')
  let changed!: () => void
  mockWindowApp.onSessionChanged.mockImplementation((callback) => {
    changed = callback
    return () => {}
  })
  render(<AppSidebar />)
  await screen.findByText('Old Session')
  const fresh = deferred<typeof sessionFixtures.byFolder[string]>()
  mockEnvironment.listSessions.mockImplementationOnce(() => fresh.promise)
  await act(async () => changed())
  registerChild()
  const project = chatState.projectSessions['/project-a'] as {
    _sessions: Record<string, Record<string, unknown>>
  }
  project._sessions.child._historyHydrated = false
  project._sessions.child._parentSessionId = undefined
  await act(async () => notifyChat())

  expect(screen.queryByText('New child')).not.toBeInTheDocument()
  await act(async () => {
    project._sessions.child._historyHydrated = true
    project._sessions.child._parentSessionId = 'sid-1'
    notifyChat()
  })
  const liveRow = screen.getByText('New child').closest('.group\\/session')!
  expect(liveRow).not.toBeNull()
  expect(liveRow.querySelector('.lucide-corner-down-right')).not.toBeNull()
  await act(async () => fresh.resolve(sessionFixtures.byFolder['/project-a']))
  const childRow = await screen.findByText('New child')
  expect(childRow.closest('.group\\/session')!.querySelector('.lucide-corner-down-right')).not.toBeNull()
})
