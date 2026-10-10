import { expect, jest, test } from '@jest/globals'
import { act, fireEvent, screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { SessionMenuBody } from './session-menu'
import { useState } from 'react'

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
  expect(screen.queryByLabelText('Show Codex conversation')).toBeNull()
  expect(screen.queryByLabelText('Show voice conversation')).toBeNull()
})

test('switches both histories from the session menu with translated labels', async () => {
  const toggled = jest.fn()
  function Menu() {
    const [view, setView] = useState<'realtime' | 'thread'>('realtime')
    return <SessionMenuBody onOpenTerminal={() => {}} onOpenFiles={() => {}} conversationView={view}
      onToggleConversationView={() => { toggled(); setView(view === 'realtime' ? 'thread' : 'realtime') }} />
  }
  await renderWithTheme(<Menu />, 'dark', 'zh')
  await press('查看 Codex 会话')
  expect(screen.queryByLabelText('查看 Codex 会话')).toBeNull()
  await press('查看语音会话')
  expect(screen.getByLabelText('查看 Codex 会话')).toBeTruthy()
  expect(toggled).toHaveBeenCalledTimes(2)
})
