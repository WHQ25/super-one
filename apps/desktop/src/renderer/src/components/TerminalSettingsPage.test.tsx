/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalCommandRule } from '@superone/shared/terminal-command-rules'

const listCommandRules = vi.fn()
const removeCommandRule = vi.fn()

Object.defineProperty(window, 'terminal', {
  configurable: true,
  value: { listCommandRules, removeCommandRule },
})

vi.mock('@/stores/app', () => {
  const state = {
    recentFolders: [
      { id: 'f1', path: '/Users/dev/super-one', name: 'My Custom Name', lastOpened: '', addedAt: '' },
    ],
  }
  return { useAppStore: (selector: (value: typeof state) => unknown) => selector(state) }
})

const { TerminalSettingsPage } = await import('./TerminalSettingsPage')

const rule = (projectKey: string, pattern: string): TerminalCommandRule => ({ projectKey, pattern, createdAt: '' })

async function renderPage(rules: TerminalCommandRule[]) {
  listCommandRules.mockResolvedValue(rules)
  const view = render(<TerminalSettingsPage />)
  await screen.findByText('Always-Allowed Commands')
  await waitFor(() => expect(listCommandRules).toHaveBeenCalled())
  return view
}

beforeEach(() => {
  listCommandRules.mockReset()
  removeCommandRule.mockReset()
  removeCommandRule.mockResolvedValue(true)
})

describe('terminal settings — always-allowed command rules', () => {
  it('explains the empty state instead of showing a blank card', async () => {
    await renderPage([])
    expect(await screen.findByText('No commands are always allowed yet.')).toBeTruthy()
  })

  it('groups rules by project and names a registered project the way the sidebar does', async () => {
    await renderPage([
      rule('/Users/dev/super-one', 'bun run storybook:*'),
      rule('/Users/dev/super-one', 'python3'),
      rule('/Users/dev/other', 'ssh staging:*'),
    ])
    expect(await screen.findByText('My Custom Name')).toBeTruthy()
    expect(screen.getByText('other')).toBeTruthy()
    expect(screen.getByText('bun run storybook:*')).toBeTruthy()
    expect(screen.getByText('python3')).toBeTruthy()
    expect(screen.getByText('ssh staging:*')).toBeTruthy()
    expect(screen.queryByText('Remote')).toBeNull()
  })

  it('shows a remote project by its node path with a Remote badge', async () => {
    await renderPage([rule('remote:node-1:/srv/api', 'docker compose up:*')])
    expect(await screen.findByText('api')).toBeTruthy()
    expect(screen.getByText('/srv/api')).toBeTruthy()
    expect(screen.getByText('Remote')).toBeTruthy()
  })

  it('removes one rule through IPC and re-reads the list', async () => {
    const kept = rule('/Users/dev/super-one', 'python3')
    await renderPage([rule('/Users/dev/super-one', 'bun run storybook:*'), kept])
    await screen.findByText('bun run storybook:*')
    listCommandRules.mockResolvedValue([kept])

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove this rule' })[0]!)

    await waitFor(() => expect(screen.queryByText('bun run storybook:*')).toBeNull())
    expect(removeCommandRule).toHaveBeenCalledWith('/Users/dev/super-one', 'bun run storybook:*')
    expect(screen.getByText('python3')).toBeTruthy()
  })

  it('offers a retry when the list cannot be read', async () => {
    listCommandRules.mockRejectedValueOnce(new Error('database locked'))
    render(<TerminalSettingsPage />)
    expect(await screen.findByText('Could not load the rules.')).toBeTruthy()

    listCommandRules.mockResolvedValue([rule('/Users/dev/super-one', 'python3')])
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('python3')).toBeTruthy()
  })
})
