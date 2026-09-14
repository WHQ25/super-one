import { expect, jest, test } from '@jest/globals'
import { act, fireEvent, screen } from '@testing-library/react-native'
import type { PendingPrompt } from '../pending-prompt-state'
import { renderWithTheme } from '../test-render'
import { PendingPromptBar } from './pending-prompt-bar'

const bash: PendingPrompt = { kind: 'permission', request: { requestId: 'perm-1', toolName: 'Bash', input: { command: 'bun run test' }, allowAlwaysAllow: true } }
const question: PendingPrompt = { kind: 'question', request: { requestId: 'q-1', questions: [{ header: 'Lib', question: 'Which library?', options: [{ label: 'A', description: '' }], multiSelect: false }] } }

test('names the request and its one-line detail', async () => {
  await renderWithTheme(<PendingPromptBar prompt={bash} onExpand={() => {}} />)

  expect(screen.getByText('Bash')).toBeTruthy()
  expect(screen.getByText('bun run test')).toBeTruthy()
})

test('translates the title the sheet header uses', async () => {
  await renderWithTheme(<PendingPromptBar prompt={question} onExpand={() => {}} />, 'dark', 'zh')

  expect(screen.getByText('问题')).toBeTruthy()
  expect(screen.getByText('Which library?')).toBeTruthy()
})

test('a tap anywhere reopens the request; there is no close on the strip', async () => {
  // The strip exists so a stray tap can never resolve the request — the only
  // way out is the sheet's own close button or actions.
  const onExpand = jest.fn()
  await renderWithTheme(<PendingPromptBar prompt={bash} onExpand={onExpand} />)

  expect(screen.queryByLabelText(/close/i)).toBeNull()
  // `Pulse` sits on `useIconMotion`'s external store; see CLAUDE.md on `act`.
  await act(async () => { fireEvent.press(screen.getByLabelText('Bash')) })
  expect(onExpand).toHaveBeenCalledWith('perm-1')
})
