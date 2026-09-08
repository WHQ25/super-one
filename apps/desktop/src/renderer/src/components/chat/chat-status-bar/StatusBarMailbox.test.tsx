/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { CollaborationMailboxMessage } from '@superone/shared/collaboration-mailbox'
import { StatusBarMailbox } from './StatusBarMailbox'

const list = vi.fn()
let changed: (sessionId: string) => void
const unsubscribe = vi.fn()
const mail: CollaborationMailboxMessage = {
  id: 'mail-1', fromSessionId: 'sender', fromTitle: 'Reviewer',
  content: 'Please check the result', createdAt: '2026-09-08T12:00:00Z',
}

beforeEach(() => {
  list.mockReset().mockResolvedValue([])
  unsubscribe.mockReset()
  Object.assign(window.app, {
    collaborationMailbox: {
      list,
      onChanged: (callback: typeof changed) => { changed = callback; return unsubscribe },
    },
  })
})

it('opens unread messages and removes the indicator when the agent retrieves them', async () => {
  const view = render(<StatusBarMailbox sessionId="recipient" />)
  await waitFor(() => expect(list).toHaveBeenCalledWith('recipient'))
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  list.mockResolvedValue([mail])
  await act(async () => changed('recipient'))
  fireEvent.click(await screen.findByRole('button'))
  expect(await screen.findByText(mail.content)).toBeInTheDocument()
  expect(screen.getByText('Reviewer')).toBeInTheDocument()
  expect(list).toHaveBeenCalledTimes(2)
  list.mockResolvedValue([])
  await act(async () => changed('recipient'))
  await waitFor(() => expect(screen.queryByRole('button')).not.toBeInTheDocument())
  expect(screen.queryByText(mail.content)).not.toBeInTheDocument()
  view.unmount()
  expect(unsubscribe).toHaveBeenCalledOnce()
})

it('ignores stale fetches and notifications from another session', async () => {
  let resolveOld!: (messages: CollaborationMailboxMessage[]) => void
  list.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
  const view = render(<StatusBarMailbox sessionId="old" />)
  view.rerender(<StatusBarMailbox sessionId="new" />)
  await act(async () => resolveOld([mail]))
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  await act(async () => changed('old'))
  expect(list).toHaveBeenCalledTimes(2)
  view.unmount()
})
