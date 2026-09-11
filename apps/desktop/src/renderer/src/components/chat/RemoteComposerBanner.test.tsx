/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { RemoteComposerBanner } from './RemoteComposerBanner'
it('labels the composer read only and lets the user disconnect', () => {
  const disconnect = vi.fn()
  render(<RemoteComposerBanner onDisconnect={disconnect} />)
  expect(screen.getByText('Remote draft active — observation mode.')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
  expect(disconnect).toHaveBeenCalledOnce()
})
