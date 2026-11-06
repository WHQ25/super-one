/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { SidebarFocusViewProps } from './SidebarFocusView'
import { SidebarFocusView } from './SidebarFocusView'
import { applySidebarFocus, focusSession } from './sidebar-focus'
import { focusEnvironments, focusLocal, focusRemote, focusSessionEntry } from './project-focus.fixtures'

function props(): SidebarFocusViewProps {
  return {
    environments: focusEnvironments, folders: [], localHostLabel: 'This computer', sort: 'recent',
    expandedProjectKeys: new Set(), folderSessions: { [focusLocal.pathKey]: [focusSessionEntry('parent', 'Parent workflow')] },
    loadingFolders: {}, openingSession: null, connectionBusyId: null, refreshingConnectionId: null,
    onLoadFolderSessions: vi.fn(), onSwitchSession: vi.fn(), onToggleProject: vi.fn(),
    onPinSession: vi.fn(), onSettleSession: vi.fn(), onRenameSession: vi.fn(), onDeleteSession: vi.fn(),
    onEditProject: vi.fn(), onRemoveProject: vi.fn(), onNewSession: vi.fn(), onRefreshEnvironment: vi.fn(),
    onToggleConnection: vi.fn(), onAddProject: vi.fn(),
  }
}
const child = (id: string) => ({ ...focusSessionEntry(id, id), parentSessionId: 'parent' })
beforeEach(() => {
  window.environment.listSessions = vi.fn(async () => [])
  window.app.onSessionChanged = vi.fn(() => () => {})
  focusSession(focusLocal.pathKey, 'parent', focusLocal.environmentId)
})
afterEach(() => { applySidebarFocus(null); vi.restoreAllMocks() })

it('loads one parent across hosts, groups by environment, and routes child actions to their host', async () => {
  const list = vi.spyOn(window.environment, 'listSessions').mockImplementation(async (connectionId, projectId) => (
    connectionId === 'local' ? [child('Local child')] : projectId === focusRemote.projectId ? [child('Remote child')] : []
  ) as never)
  const data = props()
  const { container } = render(<SidebarFocusView {...data} />)
  await screen.findByText('Remote child')
  const children = container.querySelector('[data-session-focus-children]')! as HTMLElement
  expect(within(children).getByRole('button', { name: /This computer/ })).toHaveAttribute('data-sidebar-section', 'environment')
  expect(within(children).getByRole('button', { name: /Build server/ })).toHaveAttribute('aria-expanded', 'true')
  expect(list).toHaveBeenCalledWith('node-1', focusRemote.projectId, { limit: 20, offset: 0, parentSessionId: 'parent' })
  fireEvent.click(screen.getByText('Remote child'))
  expect(data.onSwitchSession).toHaveBeenCalledWith(focusRemote.pathKey, 'Remote child', { revealProject: false })
})

it('pages each environment and refreshes the visible family when a child changes', async () => {
  let changed: ((path?: string) => void) | undefined
  vi.spyOn(window.app, 'onSessionChanged').mockImplementation((listener) => { changed = listener; return () => {} })
  const list = vi.spyOn(window.environment, 'listSessions').mockImplementation(async (connectionId, projectId, options) => (
    connectionId === 'node-1' && projectId === focusRemote.projectId
      ? Array.from({ length: options.offset === 0 ? 20 : 1 }, (_, i) => child(`Child ${options.offset + i}`)) : []
  ) as never)
  const { container } = render(<SidebarFocusView {...props()} />)
  await screen.findByText('Child 0')
  fireEvent.scroll(container.querySelector('[data-child-session-list] [data-slot="scroll-area-viewport"]')!)
  await waitFor(() => expect(list).toHaveBeenCalledWith('node-1', focusRemote.projectId, { limit: 20, offset: 20, parentSessionId: 'parent' }))
  list.mockClear()
  act(() => changed?.(focusRemote.pathKey))
  await waitFor(() => expect(list).toHaveBeenCalledWith('node-1', focusRemote.projectId, { limit: 20, offset: 0, parentSessionId: 'parent' }))
  await waitFor(() => expect(list).toHaveBeenCalledWith('node-1', focusRemote.projectId, { limit: 20, offset: 20, parentSessionId: 'parent' }))
})

it('offers retry on a failed environment and does not contact offline hosts', async () => {
  const list = vi.spyOn(window.environment, 'listSessions').mockRejectedValue(new Error('disconnected'))
  const data = props()
  data.environments = focusEnvironments.map((bucket) => bucket.kind === 'local' ? bucket : { ...bucket, connection: 'offline' })
  render(<SidebarFocusView {...data} />)
  const retry = await screen.findByRole('button', { name: /Could not load child sessions/ })
  expect(list.mock.calls.every(([connection]) => connection === 'local')).toBe(true)
  list.mockResolvedValue([child('Recovered child')] as never)
  fireEvent.click(retry)
  await screen.findByText('Recovered child')
})

it('ignores an old response when a session-change notification starts a newer read', async () => {
  let changed: ((path?: string) => void) | undefined
  let resolveOld!: (rows: unknown[]) => void
  const old = new Promise<unknown[]>((resolve) => { resolveOld = resolve })
  vi.spyOn(window.app, 'onSessionChanged').mockImplementation((listener) => { changed = listener; return () => {} })
  const list = vi.spyOn(window.environment, 'listSessions').mockImplementationOnce(() => old as never).mockResolvedValue([child('New child')] as never)
  const data = props()
  data.environments = [focusEnvironments[0]!]
  render(<SidebarFocusView {...data} />)
  await waitFor(() => expect(list).toHaveBeenCalledTimes(1))
  act(() => changed?.(focusLocal.pathKey))
  await screen.findByText('New child')
  await act(async () => resolveOld([child('Stale child')]))
  expect(screen.queryByText('Stale child')).not.toBeInTheDocument()
  expect(screen.getByText('New child')).toBeInTheDocument()
})
