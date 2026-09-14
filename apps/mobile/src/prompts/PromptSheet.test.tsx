import { expect, jest, test } from '@jest/globals'
import { act, fireEvent, screen } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import type { ReactElement } from 'react'
import type { PermissionRequest } from '@superone/shared/agent-types'
import { renderWithTheme } from '../test-render'
import { PermissionSheet } from './PermissionSheet'

const bash: PermissionRequest = { requestId: 'perm-1', toolName: 'Bash', input: { command: 'bun run test' }, allowAlwaysAllow: true }

/** `PromptSheet` reads the status-bar inset directly; outside a provider that hook throws. */
function withInsets(ui: ReactElement) {
  return <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
    {ui}
  </SafeAreaProvider>
}

async function renderSheet(ui: ReactElement) {
  const view = await renderWithTheme(withInsets(ui))
  // `renderWithTheme` re-wraps its own provider on rerender; this one is ours to re-add.
  return { ...view, rerender: (next: ReactElement) => view.rerender(withInsets(next)) }
}

test('an outside tap puts the sheet away instead of denying', async () => {
  const onDeny = jest.fn()
  const onCollapse = jest.fn()
  await renderSheet(<PermissionSheet perm={bash} onAllow={() => {}} onDeny={onDeny} onCollapse={onCollapse} />)

  await act(async () => { fireEvent.press(screen.getByLabelText('Put Dialog Away')) })

  expect(onCollapse).toHaveBeenCalledWith('perm-1')
  expect(onDeny).not.toHaveBeenCalled()
})

test('the close button is the decision: it denies', async () => {
  const onDeny = jest.fn()
  const onCollapse = jest.fn()
  await renderSheet(<PermissionSheet perm={bash} onAllow={() => {}} onDeny={onDeny} onCollapse={onCollapse} />)

  await act(async () => { fireEvent.press(screen.getByTestId('prompt-close')) })

  expect(onDeny).toHaveBeenCalledWith('perm-1', undefined)
  expect(onCollapse).not.toHaveBeenCalled()
})

test('without a collapse handler the scrim still dismisses, so pickers keep their behaviour', async () => {
  const onDeny = jest.fn()
  await renderSheet(<PermissionSheet perm={bash} onAllow={() => {}} onDeny={onDeny} />)

  await act(async () => { fireEvent.press(screen.getByLabelText('Dismiss Dialog')) })

  expect(onDeny).toHaveBeenCalledWith('perm-1', undefined)
})

test('a put-away sheet keeps what was typed for when it comes back', async () => {
  const sheet = (collapsed: boolean) => <PermissionSheet perm={bash} collapsed={collapsed} onCollapse={() => {}} onAllow={() => {}} onDeny={() => {}} />
  const view = await renderSheet(sheet(false))
  await act(async () => { fireEvent.changeText(screen.getByTestId('prompt-feedback'), 'not on main') })
  expect(screen.getByDisplayValue('not on main')).toBeTruthy()

  await act(async () => { view.rerender(sheet(true)) })
  expect(screen.queryByTestId('prompt-title')).toBeNull()

  await act(async () => { view.rerender(sheet(false)) })
  expect(screen.getByDisplayValue('not on main')).toBeTruthy()
})
