/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { RemoteControlBanner } from './RemoteControllerBanner'

it('names the computer driving the session and offers its action', () => {
  const onAction = vi.fn()
  render(<RemoteControlBanner label="MacBook Air" action="disconnect" onAction={onAction} />)
  expect(screen.getByRole('status')).toHaveTextContent('MacBook Air is controlling this session.')
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
  expect(onAction).toHaveBeenCalledOnce()
})

it('falls back when that computer gave no name, and disables the action while it runs', () => {
  render(<RemoteControlBanner label={null} action="reconnect" busy onAction={() => {}} />)
  expect(screen.getByRole('status')).toHaveTextContent('Another computer is controlling this session.')
  expect(screen.getByRole('button', { name: 'Reconnect' })).toBeDisabled()
})

it('offers Take over from the host window, and nothing for a phone that cannot be taken', () => {
  const onAction = vi.fn()
  const { unmount } = render(<RemoteControlBanner label="Mac mini" action="takeOver" onAction={onAction} />)
  fireEvent.click(screen.getByRole('button', { name: 'Take Over' }))
  expect(onAction).toHaveBeenCalledOnce()
  unmount()

  render(<RemoteControlBanner label={null} device="phone" />)
  expect(screen.getByRole('status')).toHaveTextContent('A phone is controlling this session.')
  expect(screen.queryByRole('button')).toBeNull()
})
