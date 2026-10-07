import { expect, jest, test } from '@jest/globals'
import { act, fireEvent, screen } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import type { ReactElement } from 'react'
import type { PermissionRequest } from '@superone/shared/agent-types'
import { renderWithTheme } from '../test-render'
import { PermissionSheet } from './PermissionSheet'

const bash: PermissionRequest = { requestId: 'perm-1', toolName: 'Bash', input: { command: 'bun run test' }, allowAlwaysAllow: true }

test('external-directory approval uses a semantic title and keeps call context behind technical details', async () => {
  const onAllow = jest.fn()
  const request: PermissionRequest = {
    requestId: 'per_external', toolName: 'external_directory', input: {}, allowAlwaysAllow: false,
    permissionDetails: { action: 'external_directory', resources: ['/outside/reference/*', '/outside/second/*'], save: ['/outside/*'],
      source: { toolName: 'read', toolUseId: 'call_read', input: { path: '/outside/reference/spec.md', limit: 200 } },
      metadata: { reason: 'Reference implementation' } },
  }
  await renderSheet(<PermissionSheet perm={request} onAllow={onAllow} onDeny={() => {}} />)
  expect(screen.getByText('Access External Directory /outside/reference')).toBeTruthy()
  expect(screen.getByText('/outside/reference/*\n/outside/second/*')).toBeTruthy()
  expect(screen.queryByText('read · call_read')).toBeNull()
  await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Technical Details' })) })
  expect(screen.getByText('/outside/*')).toBeTruthy()
  expect(screen.getByText(/"path": "\/outside\/reference\/spec.md"/)).toBeTruthy()
  expect(screen.getByText(/Reference implementation/)).toBeTruthy()
  expect(screen.getByText('read · call_read')).toBeTruthy()
  await act(async () => { fireEvent.press(screen.getByTestId('prompt-approve')) })
  expect(onAllow).toHaveBeenCalledWith('per_external', undefined, false, undefined)
})

test('a remembered native permission previews project patterns before confirmation and can be cancelled', async () => {
  const onAllow = jest.fn()
  const onDeny = jest.fn()
  const request: PermissionRequest = { requestId: 'per_save', toolName: 'external_directory', input: {}, allowAlwaysAllow: true,
    permissionDetails: { action: 'external_directory', resources: ['/outside/reference/*'], save: ['/outside/*'] } }
  await renderSheet(<PermissionSheet perm={request} onAllow={onAllow} onDeny={onDeny} />)
  await act(async () => { fireEvent.press(screen.getByTestId('prompt-option-Remember for This Project')) })
  expect(screen.getByText('Remember Permission in This Project?')).toBeTruthy()
  expect(screen.getByText('/outside/*')).toBeTruthy()
  expect(onAllow).not.toHaveBeenCalled()
  await act(async () => { fireEvent.press(screen.getByTestId('prompt-reject')) })
  expect(onDeny).not.toHaveBeenCalled()
  expect(screen.getByText('Allow Once')).toBeTruthy()
  await act(async () => { fireEvent.press(screen.getByTestId('prompt-option-Remember for This Project')) })
  await act(async () => { fireEvent.press(screen.getByTestId('prompt-approve')) })
  expect(onAllow).toHaveBeenCalledWith('per_save', undefined, true, undefined)
})

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

const terminal: PermissionRequest = {
  requestId: 'perm-term',
  toolName: 'mcp__superone__terminal_tabs',
  input: { action: 'run', command: 'bun run dev', cwd: '/repo', rule: 'bun run( .*)?' },
  allowAlwaysAllow: true,
  supportsAlwaysPersist: true,
  requestKind: 'terminal_command_confirm',
  serverName: 'superone',
}

test('a terminal command remembers its rule for the session or the project, one at a time', async () => {
  const onAllow = jest.fn()
  await renderSheet(<PermissionSheet perm={terminal} onAllow={onAllow} onDeny={() => {}} />)
  const session = () => screen.getByTestId('prompt-option-Allow for Session')
  const project = () => screen.getByTestId('prompt-option-Always Allow')

  await act(async () => { fireEvent.press(session()) })
  expect(session().props.accessibilityState.checked).toBe(true)
  await act(async () => { fireEvent.press(project()) })
  expect(session().props.accessibilityState.checked).toBe(false)
  expect(project().props.accessibilityState.checked).toBe(true)

  await act(async () => { fireEvent.press(screen.getByTestId('prompt-approve')) })
  // The lifetime rides in formAnswers; alwaysAllow stays the desktop's "remember" flag.
  expect(onAllow).toHaveBeenLastCalledWith('perm-term', { scope: 'project' }, true, undefined)

  await act(async () => { fireEvent.press(project()) })
  await act(async () => { fireEvent.press(session()) })
  await act(async () => { fireEvent.press(screen.getByTestId('prompt-approve')) })
  expect(onAllow).toHaveBeenLastCalledWith('perm-term', { scope: 'session' }, false, undefined)
})

test('a plain terminal approve carries no rule', async () => {
  const onAllow = jest.fn()
  await renderSheet(<PermissionSheet perm={terminal} onAllow={onAllow} onDeny={() => {}} />)
  await act(async () => { fireEvent.press(screen.getByTestId('prompt-approve')) })
  expect(onAllow).toHaveBeenLastCalledWith('perm-term', undefined, false, undefined)
})
