import { expect, jest, test } from '@jest/globals'
import { act } from '@testing-library/react-native'
import { Animated, BackHandler, Keyboard } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { renderWithTheme } from '../test-render'
import { WorkspaceDrawer, type WorkspaceDrawerProps } from './workspace-drawer'
import type { SessionListRow } from '../session-list-state'

const seed: SessionListRow[] = [{ sessionId: 's1', title: 'Fix the drawer' }]
const noop = () => {}
const confirmed = () => Promise.resolve(true)

const drawer = (overrides: Partial<WorkspaceDrawerProps> = {}) => (
  <SafeAreaProvider initialMetrics={{
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: { top: 47, left: 0, right: 0, bottom: 34 },
  }}>
  <WorkspaceDrawer
    client={null}
    projects={[{ path: '/repo', name: 'repo' }]}
    activeProject={{ path: '/repo', name: 'repo' }}
    activeSessionId="s1"
    sessions={seed}
    visible={false}
    listRevision={0}
    onNewSession={noop}
    onOpenSession={noop}
    onPinSession={confirmed}
    onArchiveSession={confirmed}
    onDeleteSession={confirmed}
    onSearch={noop}
    onAddProject={noop}
    onDismiss={noop}
    deviceName="Studio"
    deviceStatus="connectedLan"
    onDisconnect={noop}
    onOpenAppSettings={noop}
    {...overrides}
  />
  </SafeAreaProvider>
)

test('dismisses the keyboard when the drawer opens over the composer', async () => {
  const start = jest.fn()
  // Opening mounts the list in the same commit; the test renderer has no native
  // view tag for the panel's useNativeDriver spring.
  const spring = jest.spyOn(Animated, 'spring').mockReturnValue({ start } as never)
  const timing = jest.spyOn(Animated, 'timing').mockReturnValue({ start } as never)
  const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {})
  try {
    const view = await renderWithTheme(drawer())
    dismiss.mockClear()
    await view.rerender(drawer({ visible: true }))
    expect(dismiss).toHaveBeenCalled()
  } finally {
    dismiss.mockRestore()
    spring.mockRestore()
    timing.mockRestore()
  }
})

test('is not in the tree while hidden, so nothing sits over the chat', async () => {
  const view = await renderWithTheme(drawer())
  expect(view.queryByTestId('workspace-drawer')).toBeNull()
})

test('mounts as an overlay in the shell rather than a native modal', async () => {
  const start = jest.fn()
  const spring = jest.spyOn(Animated, 'spring').mockReturnValue({ start } as never)
  const timing = jest.spyOn(Animated, 'timing').mockReturnValue({ start } as never)
  try {
    const view = await renderWithTheme(drawer({ visible: true }))
    expect(view.getByTestId('workspace-drawer')).toBeTruthy()
  } finally {
    spring.mockRestore()
    timing.mockRestore()
  }
})

test('the hardware back button closes the drawer while it is open', async () => {
  const start = jest.fn()
  const spring = jest.spyOn(Animated, 'spring').mockReturnValue({ start } as never)
  const timing = jest.spyOn(Animated, 'timing').mockReturnValue({ start } as never)
  const onDismiss = jest.fn()
  const handlers: Array<() => boolean | null | undefined> = []
  const back = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_, handler) => {
    handlers.push(handler)
    return { remove: () => { handlers.splice(handlers.indexOf(handler), 1) } }
  })
  try {
    await renderWithTheme(drawer({ visible: true, onDismiss }))
    expect(handlers).toHaveLength(1)
    expect(handlers[0]!()).toBe(true)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  } finally {
    back.mockRestore()
    spring.mockRestore()
    timing.mockRestore()
  }
})

test('stays mounted through the close animation and leaves once it finishes', async () => {
  const callbacks: Array<(result: { finished: boolean }) => void> = []
  const start = jest.fn((done?: (result: { finished: boolean }) => void) => { if (done) callbacks.push(done) })
  const spring = jest.spyOn(Animated, 'spring').mockReturnValue({ start } as never)
  const timing = jest.spyOn(Animated, 'timing').mockReturnValue({ start } as never)
  try {
    const view = await renderWithTheme(drawer({ visible: true }))
    await view.rerender(drawer({ visible: false }))
    expect(view.getByTestId('workspace-drawer')).toBeTruthy()
    await act(async () => { for (const done of callbacks.splice(0)) done({ finished: true }) })
    expect(view.queryByTestId('workspace-drawer')).toBeNull()
  } finally {
    spring.mockRestore()
    timing.mockRestore()
  }
})
