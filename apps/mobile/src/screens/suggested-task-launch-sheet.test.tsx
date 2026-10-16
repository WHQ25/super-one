import { expect, it, jest } from '@jest/globals'
import { act, fireEvent, waitFor } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { SuggestedTaskLaunchSheet } from './suggested-task-launch-sheet'
import { suggestedTaskOptions as options } from './suggested-task-launch-fixtures'
import type { SuggestedTaskLaunchRequest } from '../suggested-task-actions'
import { permissionModeLabel } from '../ui/permission-mode-selector'

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }))

function request(): SuggestedTaskLaunchRequest {
  return { loadOptions: jest.fn(async () => options), launch: jest.fn(async () => ({ sessionId: 'child' })) }
}

it('lets the user choose agent, model and permissions before launching', async () => {
  const target = request(), onDismiss = jest.fn()
  const view = await renderWithTheme(<SuggestedTaskLaunchSheet request={target} onDismiss={onDismiss} />)
  await waitFor(() => expect(view.getByText('Opus')).toBeTruthy())
  expect(target.launch).not.toHaveBeenCalled()
  await act(async () => { fireEvent.press(view.getByTestId('prompt-select-Agent')) })
  await act(async () => { fireEvent.press(view.getByRole('radio', { name: 'Codex' })) })
  expect(view.getByText('GPT Basic')).toBeTruthy()
  await act(async () => { fireEvent.press(view.getByTestId('prompt-select-Model')) })
  await act(async () => { fireEvent.press(view.getByRole('radio', { name: 'GPT Other' })) })
  await act(async () => { fireEvent.press(view.getByTestId('prompt-select-Permission mode')) })
  await act(async () => { fireEvent.press(view.getByRole('radio', { name: permissionModeLabel('bypassPermissions', 'codex') })) })
  await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Launch' })) })
  expect(target.launch).toHaveBeenCalledWith({ agentId: 'codex-base', settings: { model: 'gpt-other', fastMode: false, permissionMode: 'bypassPermissions' } })
  expect(onDismiss).toHaveBeenCalledTimes(1)
})

it('restores the source agent settings when switching back and retains them after a launch failure', async () => {
  const target = request()
  jest.mocked(target.launch).mockRejectedValueOnce(new Error('Host is offline'))
  const view = await renderWithTheme(<SuggestedTaskLaunchSheet request={target} onDismiss={() => {}} />)
  await waitFor(() => expect(view.getByText('Opus')).toBeTruthy())
  await act(async () => { fireEvent.press(view.getByTestId('prompt-select-Agent')) })
  await act(async () => { fireEvent.press(view.getByRole('radio', { name: 'Codex' })) })
  await act(async () => { fireEvent.press(view.getByTestId('prompt-select-Agent')) })
  await act(async () => { fireEvent.press(view.getByRole('radio', { name: 'Claude' })) })
  await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Launch' })) })
  expect(view.getByRole('alert')).toHaveTextContent('Host is offline')
  expect(view.getByText('Opus')).toBeTruthy()
  await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Launch' })) })
  expect(target.launch).toHaveBeenNthCalledWith(1, options.initial)
  expect(target.launch).toHaveBeenNthCalledWith(2, options.initial)
})

it('shows a load failure in Chinese and allows retry or cancel without starting a session', async () => {
  const target = request(), onDismiss = jest.fn()
  jest.mocked(target.loadOptions).mockRejectedValueOnce(new Error('Host is offline'))
  const view = await renderWithTheme(<SuggestedTaskLaunchSheet request={target} onDismiss={onDismiss} />, 'light', 'zh')
  await waitFor(() => expect(view.getByRole('alert')).toHaveTextContent('Host is offline'))
  expect(view.getByText('启动任务')).toBeTruthy()
  expect(view.getByRole('button', { name: '启动' }).props.accessibilityState.disabled).toBe(true)
  await act(async () => { fireEvent.press(view.getByRole('button', { name: '重试' })) })
  await waitFor(() => expect(view.getByText('Opus')).toBeTruthy())
  await act(async () => { fireEvent.press(view.getByRole('button', { name: '取消' })) })
  expect(onDismiss).toHaveBeenCalledTimes(1)
  expect(target.launch).not.toHaveBeenCalled()
})

it('keeps launch disabled while options load', async () => {
  const target = request()
  target.loadOptions = () => new Promise(() => {})
  const view = await renderWithTheme(<SuggestedTaskLaunchSheet request={target} onDismiss={() => {}} />)
  expect(view.getByRole('button', { name: 'Launch' }).props.accessibilityState.disabled).toBe(true)
  expect(view.getByLabelText('Loading agents…')).toBeTruthy()
})

it('prevents duplicate launches and keeps the config surface until launch completes', async () => {
  const target = request(), onDismiss = jest.fn()
  let finish!: (value: { sessionId: string }) => void
  target.launch = jest.fn(() => new Promise<{ sessionId: string }>(resolve => { finish = resolve }))
  const view = await renderWithTheme(<SuggestedTaskLaunchSheet request={target} onDismiss={onDismiss} />)
  await waitFor(() => expect(view.getByText('Opus')).toBeTruthy())
  await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Launch' })) })
  const pending = view.getByRole('button', { name: 'Starting session…' })
  expect(pending.props.accessibilityState.disabled).toBe(true)
  await act(async () => { fireEvent.press(pending); fireEvent.press(view.getByTestId('prompt-close')) })
  expect(target.launch).toHaveBeenCalledTimes(1)
  expect(onDismiss).not.toHaveBeenCalled()
  await act(async () => { finish({ sessionId: 'child' }) })
  expect(onDismiss).toHaveBeenCalledTimes(1)
})


it('offers Claude Fast Mode for the official API and passes it in the launch choice', async () => {
  const target = request()
  const view = await renderWithTheme(<SuggestedTaskLaunchSheet request={target} onDismiss={() => {}} />)
  await waitFor(() => expect(view.getByText('Opus')).toBeTruthy())
  await act(async () => { fireEvent(view.getByLabelText('Fast Mode'), 'valueChange', true) })
  await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Launch' })) })
  expect(target.launch).toHaveBeenCalledWith({ ...options.initial, settings: { ...options.initial.settings, claudeFastMode: true } })
})
