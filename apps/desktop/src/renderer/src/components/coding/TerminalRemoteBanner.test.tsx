/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TerminalRemoteBanner } from './TerminalRemoteBanner'

describe('TerminalRemoteBanner', () => {
  it('mirrors the remote-session observation copy and disconnects on click', () => {
    const onDisconnect = vi.fn()
    render(<TerminalRemoteBanner onDisconnect={onDisconnect} />)
    expect(screen.getByText(/observation mode/i)).toBeInTheDocument()
    screen.getByRole('button', { name: 'Disconnect' }).click()
    expect(onDisconnect).toHaveBeenCalled()
  })
})
