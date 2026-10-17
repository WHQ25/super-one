/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useChatStore, createDefaultProjectState } from '@/stores/chat'
import { resetRealtimeCallForTests, useRealtimeCallStore } from '@/stores/realtime-call'
import { useCodexRealtimeViewStore } from '@/stores/codex-realtime-view'
import { ComposerVoiceEntry } from '../chat/ComposerVoiceEntry'
import { CodingWorkspace } from '../coding/CodingWorkspace'
import { mosaicTileId, useMosaicStore } from './mosaic-store'
import { findLeaf, makeLeaf } from './mosaic-tree'

// Keep production split rendering, layout actions, and voice entry; omit chat/editor chrome.
vi.mock('../chat/SessionPane', () => ({ SessionPane: ({ scope }: { scope: { projectPath: string; sessionId: string } }) =>
  <div data-testid={scope.sessionId}><ComposerVoiceEntry harness="codex" {...scope} /></div>,
}))
vi.mock('../coding/CodingLayout', () => ({ CodingLayout: ({ scope }: { scope: { projectPath: string; sessionId: string } }) =>
  <div data-testid={scope.sessionId}><ComposerVoiceEntry harness="claude" {...scope} /></div>,
}))
vi.mock('../chat/HeaderSessionMenu', () => ({ HeaderSessionMenu: () => null }))
vi.mock('../sidebar/AnimatedSessionTitle', () => ({ SessionTitleAnimated: () => null }))
vi.mock('../coding/LayoutToggle', () => ({ LayoutToggle: () => null }))
vi.mock('@/hooks/useFullscreen', () => ({ useFullscreen: () => false }))

const previousChat = useChatStore.getState()
const previousLayout = useMosaicStore.getState()
const voice = makeLeaf(mosaicTileId('/voice', 'voice'), '/voice', 'voice')
const other = makeLeaf(mosaicTileId('/repo', 'other'), '/repo', 'other')
function Workspace({ compact = false }: { compact?: boolean }) {
  const mode = useMosaicStore(state => state.mode)
  return <CodingWorkspace mosaicMode={mode} compact={compact} />
}
const visiblePane = (id: string) => screen.getAllByTestId(id).find(node => !node.closest('.hidden'))!
const entry = () => within(visiblePane('other')).queryByRole('button', { name: 'Return to Voice Conversation' })

beforeEach(() => {
  useChatStore.setState({ activeProject: '/repo', projectSessions: {
    '/repo': { ...createDefaultProjectState(), _activeSessionId: 'other' },
    '/voice': { ...createDefaultProjectState(), _activeSessionId: 'voice' },
  }, mountSession: vi.fn(async () => {}), unmountSession: vi.fn(),
  switchToSession: vi.fn(async (projectPath, sessionId) => {
    useChatStore.setState(state => ({ activeProject: projectPath, projectSessions: {
      ...state.projectSessions, [projectPath]: { ...state.projectSessions[projectPath]!, _activeSessionId: sessionId },
    } }))
  }) })
  useMosaicStore.setState({ mode: 'mosaic', root: { type: 'branch', direction: 'row', ratio: 0.5, first: voice, second: other }, focusedTileId: other.id, lastLayout: null })
  useRealtimeCallStore.setState({ state: 'active', projectPath: '/voice', sessionId: 'voice' })
})

afterEach(() => {
  cleanup()
  resetRealtimeCallForTests()
  useCodexRealtimeViewStore.setState({ sessions: {} })
  useChatStore.setState(previousChat, true)
  useMosaicStore.setState(previousLayout, true)
})

it('hides other-session entries only in the visible split and restores them after maximizing', () => {
  render(<Workspace />)
  expect(entry()).toBeNull()
  act(() => useMosaicStore.getState().setFocus(voice.id))
  expect(entry()).toBeNull()
  act(() => useMosaicStore.getState().setFocus(other.id))
  act(() => useMosaicStore.getState().exitToSingle())
  expect(entry()).toBeEnabled()
  act(() => useMosaicStore.getState().restoreLayout())
  expect(entry()).toBeNull()
})

it('restores the same global entry when selection replaces the voice split or a split closes', () => {
  render(<Workspace />)
  expect(entry()).toBeNull()
  act(() => useMosaicStore.getState().setFocus(voice.id))
  act(() => useMosaicStore.getState().focusOrReplaceFocused('/repo', 'replacement'))
  expect(entry()).toBeEnabled()
  fireEvent.click(entry()!)
  expect(useChatStore.getState().switchToSession).toHaveBeenLastCalledWith('/voice', 'voice')
  expect(findLeaf(useMosaicStore.getState().root!, voice.id)).toBeTruthy()
  expect(useRealtimeCallStore.getState()).toMatchObject({ state: 'active', projectPath: '/voice', sessionId: 'voice' })
  act(() => useMosaicStore.getState().focusOrReplaceFocused('/voice', 'voice'))
  expect(entry()).toBeNull()
  act(() => useMosaicStore.getState().removeTile(voice.id))
  expect(entry()).toBeEnabled()
})

it('matches the voice project as well as the session and preserves its own text-view return', () => {
  render(<Workspace />)
  expect(within(visiblePane('voice')).getByRole('button', { name: 'Return to Voice Conversation' })).toBeEnabled()
  act(() => useRealtimeCallStore.setState({ projectPath: '/different-project' }))
  expect(entry()).toBeEnabled()
})

it('restores the entry in the mini shell even while the stored split still contains the call', () => {
  const { rerender } = render(<Workspace />)
  expect(entry()).toBeNull()
  rerender(<Workspace compact />)
  expect(entry()).toBeEnabled()
  rerender(<Workspace />)
  expect(entry()).toBeNull()
})
