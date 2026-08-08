/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => {
  const appState = {
    updateStatus: 'available' as string,
    updateVersion: '1.2.3' as string | null,
    updateProgress: 0,
    downloadUpdate: vi.fn(),
    installUpdate: vi.fn(),
    dismissUpdate: vi.fn(),
  }
  return { appState }
})

vi.mock('@/stores/app', () => ({
  useAppStore: (selector: (s: typeof hoisted.appState) => unknown) => selector(hoisted.appState),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (key === 'shell.update.available') return 'Update'
      if (key === 'shell.update.preparingShort') return 'Preparing'
      if (key === 'shell.update.restart') return 'Restart'
      if (key === 'shell.update.preparing') return `Preparing update ${opts?.version}...`
      if (key === 'shell.update.availableHint') return `Update ${opts?.version} available`
      return key
    },
  }),
}))

vi.mock('@superone/ui/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@superone/ui/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>{children}</button>
  ),
}))

import { UpdateStatusIcon } from './UpdateStatusIcon'

describe('sidebar update pill', () => {
  beforeEach(() => {
    hoisted.appState.updateStatus = 'available'
    hoisted.appState.updateVersion = '1.2.3'
    hoisted.appState.updateProgress = 0
    hoisted.appState.downloadUpdate.mockClear()
  })

  it('starts the download when clicked in the available state', () => {
    render(<UpdateStatusIcon />)
    fireEvent.click(screen.getByRole('button'))
    expect(hoisted.appState.downloadUpdate).toHaveBeenCalledTimes(1)
  })

  it('swaps the label to a busy "Preparing" pill once preparing starts', () => {
    // electron-updater emits no progress while it fetches blockmaps, so this state can
    // last seconds — it must not render identically to the pre-click "Update" pill.
    hoisted.appState.updateStatus = 'preparing'
    render(<UpdateStatusIcon />)
    const button = screen.getByRole('button')
    expect(button.textContent).toContain('Preparing')
    expect(button.textContent).not.toContain('Update')
    expect(button).toHaveAttribute('aria-busy', 'true')
  })

  it('ignores further clicks while preparing', () => {
    hoisted.appState.updateStatus = 'preparing'
    render(<UpdateStatusIcon />)
    fireEvent.click(screen.getByRole('button'))
    expect(hoisted.appState.downloadUpdate).not.toHaveBeenCalled()
  })

  it('shows percent instead of the spinner once real progress arrives', () => {
    hoisted.appState.updateStatus = 'downloading'
    hoisted.appState.updateProgress = 42
    render(<UpdateStatusIcon />)
    const button = screen.getByRole('button')
    expect(button.textContent).toContain('42%')
    expect(button.textContent).not.toContain('Preparing')
  })
})
