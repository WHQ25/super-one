import { expect, jest, test } from '@jest/globals'
import { act, fireEvent, screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { SessionMenuBody } from './session-menu'

/** Two synchronous presses back to back overlap React 19's act scopes; await each. */
const press = (label: string) => act(async () => { fireEvent.press(screen.getByLabelText(label)) })

test('offers both fork targets when the session can fork', async () => {
  const onFork = jest.fn()
  await renderWithTheme(
    <SessionMenuBody onOpenTerminal={() => {}} onOpenFiles={() => {}} onFork={onFork} />,
  )

  await press('Fork to New Worktree')
  await press('Fork to Same Worktree')
  expect(onFork).toHaveBeenNthCalledWith(1, 'worktree')
  expect(onFork).toHaveBeenNthCalledWith(2, 'local')
})

test('leaves the fork entries out entirely when the session cannot fork', async () => {
  const onOpenTerminal = jest.fn()
  const onOpenFiles = jest.fn()
  await renderWithTheme(
    <SessionMenuBody onOpenTerminal={onOpenTerminal} onOpenFiles={onOpenFiles} />,
  )

  await press('Terminal')
  await press('Files')
  expect(onOpenTerminal).toHaveBeenCalled()
  expect(onOpenFiles).toHaveBeenCalled()
  expect(screen.queryByLabelText('Fork to New Worktree')).toBeNull()
  expect(screen.queryByLabelText('Fork to Same Worktree')).toBeNull()
})
