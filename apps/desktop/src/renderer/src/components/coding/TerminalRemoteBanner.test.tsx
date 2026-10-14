/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NODE_WINDOW_TERMINAL_OWNER } from '@superone/shared/remote-resource-key'
import { TerminalRemoteBanner } from './TerminalRemoteBanner'
import { terminalHolder } from './terminal-holder'

describe('TerminalRemoteBanner', () => {
  it("offers a takeover of a tab its node's window took back, naming that computer", () => {
    const onAction = vi.fn()
    render(<TerminalRemoteBanner holder="host" hostName="Desktop B" action="takeOver" onAction={onAction} />)
    expect(screen.getByText('Desktop B is using this terminal.')).toBeInTheDocument()
    screen.getByRole('button', { name: 'Take Over' }).click()
    expect(onAction).toHaveBeenCalled()
  })

  it('only shows a tab a phone holds without an action', () => {
    render(<TerminalRemoteBanner holder="phone" />)
    expect(screen.getByText('A phone is using this terminal.')).toBeInTheDocument()
    expect(screen.getByText('View Only')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('lets this computer take its own tab back from a controller desktop', () => {
    const onAction = vi.fn()
    render(<TerminalRemoteBanner holder="desktop" action="disconnect" onAction={onAction} />)
    expect(screen.getByText('Another computer is using this terminal.')).toBeInTheDocument()
    screen.getByRole('button', { name: 'Disconnect' }).click()
    expect(onAction).toHaveBeenCalled()
  })
})

describe('terminalHolder', () => {
  it('reads who writes in a tab from its owner id', () => {
    expect(terminalHolder(null)).toBe('me')
    expect(terminalHolder(NODE_WINDOW_TERMINAL_OWNER)).toBe('host')
    expect(terminalHolder('node:cs-1')).toBe('desktop')
    expect(terminalHolder('phone-1')).toBe('phone')
  })
})
