import { expect, jest, test } from '@jest/globals'
import { Animated, Keyboard } from 'react-native'
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
