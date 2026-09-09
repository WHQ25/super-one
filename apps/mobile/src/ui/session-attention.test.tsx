import { expect, test, jest } from '@jest/globals'
import { screen, fireEvent } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { SessionActivityContext } from '../navigation/use-session-activity'
import { WorkspaceButton } from './workspace-button'
import { SessionRowContent } from './session-row-content'
import type { SessionActivity } from '@superone/shared/session-activity'

const activity: SessionActivity = { sessionId: 'one', projectPath: '/project', status: 'idle', provider: 'codex', pendingCount: 1, pendingReason: { en: 'Allow Bash?', zh: '允许 Bash？' } }
const row = (pending = true) => <SessionActivityContext.Provider value={pending ? { one: activity } : {}}>
  <SessionRowContent item={{ session: { sessionId: 'one', title: 'Pinned', isPinned: true, provider: 'codex' }, child: false, hasChildren: false, collapsed: false }} />
</SessionActivityContext.Provider>

test('shows and clears the pending strip with background session updates', async () => {
  const result = await renderWithTheme(row())
  expect(screen.getByText('Allow Bash?')).toBeTruthy()
  await result.rerender(row(false))
  expect(screen.queryByText('Allow Bash?')).toBeNull()
})

test('uses the localized pending reason', async () => {
  await renderWithTheme(row(), 'light', 'zh')
  expect(screen.getByText('允许 Bash？')).toBeTruthy()
})

test('opens the workspace with a pending count accessible to screen readers', async () => {
  const onPress = jest.fn()
  await renderWithTheme(<WorkspaceButton pendingCount={3} onPress={onPress} />)
  await fireEvent.press(screen.getByRole('button', { name: 'Open workspace, 3 pending requests' }))
  expect(onPress).toHaveBeenCalledTimes(1)
})

test('clears the badge when all requests resolve', async () => {
  const result = await renderWithTheme(<WorkspaceButton pendingCount={120} onPress={() => {}} />)
  expect(screen.getByText('99+')).toBeTruthy()
  await result.rerender(<WorkspaceButton pendingCount={0} onPress={() => {}} />)
  expect(screen.queryByText('99+')).toBeNull()
  expect(screen.getByRole('button', { name: 'Open Workspace' })).toBeTruthy()
})

test('renders the unseen harness state and restores the pinned idle icon after reading', async () => {
  const renderRow = (isUnseen: boolean) => <SessionActivityContext.Provider value={{ one: { ...activity, isUnseen } }}>
    <SessionRowContent item={{ session: { sessionId: 'one', title: 'Pinned', isPinned: true, provider: 'codex' }, child: false, hasChildren: false, collapsed: false }} />
  </SessionActivityContext.Provider>
  const result = await renderWithTheme(renderRow(true))
  expect(screen.getByTestId('harness-icon-unseen')).toBeTruthy()
  await result.rerender(renderRow(false))
  expect(screen.queryByTestId('harness-icon-unseen')).toBeNull()
  expect(screen.getByTestId('harness-icon-default')).toBeTruthy()
})
