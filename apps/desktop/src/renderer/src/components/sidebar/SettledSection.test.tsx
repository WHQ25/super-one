/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PinnedSessionEntry } from '@superone/shared/agent-types'
import { PROJECT_SETTLED_COLLAPSE_KEY, settledPanelId } from './sidebar-section-collapse'
import { SettledSection, type SettledSectionProps } from './SettledSection'

const FOLDER = '/project-a'

const props: SettledSectionProps = {
  folderPath: FOLDER,
  sessions: [],
  onSwitchSession: vi.fn(),
  onPinSession: vi.fn(),
  onSettleSession: vi.fn(),
  onRenameSession: vi.fn(),
  onDeleteSession: vi.fn(),
}

function session(title: string): PinnedSessionEntry {
  return {
    sessionId: 'sid-1',
    title,
    lastActiveAt: '2026-03-02T00:00:00.000Z',
    messageCount: 1,
    provider: 'claude',
    isSettled: true,
    folderPath: FOLDER,
    folderName: 'project-a',
  }
}

beforeEach(() => localStorage.clear())

describe('SettledSection', () => {
  it('renders nothing when there are no settled sessions', () => {
    const { container } = render(<SettledSection {...props} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('starts folded and shows the count', () => {
    render(<SettledSection {...props} sessions={[session('Finished review')]} />)
    const header = screen.getByRole('button', { name: /Settled/ })
    expect(header).toHaveAttribute('aria-expanded', 'false')
    const count = header.querySelector('[data-slot="section-count"]')
    expect(count).toHaveTextContent('1')
    expect(count).not.toHaveClass('rounded-full')
    expect(document.querySelector('[data-slot="settled-divider"]')).toBeNull()
    expect(document.querySelector('[data-sidebar-section="settled"]')?.parentElement).toHaveClass('pl-1')
    const panel = document.getElementById(settledPanelId(FOLDER))
    expect(panel).toHaveAttribute('inert')
    expect(panel).toHaveAttribute('hidden')
    expect(panel?.querySelector('.group\\/session')).toBeNull()
    expect(screen.queryByText('Finished review')).toBeNull()
  })

  it('shows the project total rather than how many rows are loaded', () => {
    render(<SettledSection {...props} sessions={[session('Finished review')]} count={48} />)
    expect(screen.getByRole('button', { name: /Settled/ }).querySelector('[data-slot="section-count"]')).toHaveTextContent('48')
  })

  it('expands when the heading is clicked', () => {
    render(<SettledSection {...props} sessions={[session('Finished review')]} />)
    const header = screen.getByRole('button', { name: /Settled/ })
    fireEvent.click(header)
    expect(header).toHaveAttribute('aria-expanded', 'true')
    expect(header.querySelector('[data-slot="section-count"]')).toBeNull()
    const panel = document.getElementById(settledPanelId(FOLDER))
    expect(panel).not.toHaveAttribute('hidden')
    expect(panel?.querySelector('.group\\/session')).not.toBeNull()
    expect(panel?.querySelector('.group\\/pin')).toBeNull()
    expect(panel).toHaveTextContent('Finished review')
    const divider = document.querySelector('[data-slot="settled-divider"]')
    expect(divider).toHaveClass('bg-sidebar-hover', 'bottom-0')
    expect(header).toContainElement(divider)
    expect(localStorage.getItem(PROJECT_SETTLED_COLLAPSE_KEY)).toContain('"/project-a":false')
  })

  it('loads the next page when the list is scrolled near the bottom', () => {
    const onLoadMore = vi.fn(async () => {})
    const sessions = Array.from({ length: 8 }, (_, index) => ({
      ...session(`Finished ${index}`),
      sessionId: `sid-${index}`,
    }))
    render(<SettledSection {...props} sessions={sessions} hasMore onLoadMore={onLoadMore} />)
    fireEvent.click(screen.getByRole('button', { name: /Settled/ }))
    const list = document.querySelector('[data-settled-list]')
    expect(list).not.toBeNull()
    fireEvent.scroll(list!)
    expect(onLoadMore).toHaveBeenCalledTimes(1)
    fireEvent.scroll(list!)
    expect(onLoadMore).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Show More' })).toBeNull()
  })

  it('does not ask for another page when the list is complete', () => {
    const onLoadMore = vi.fn()
    render(<SettledSection {...props} sessions={[session('Finished review')]} onLoadMore={onLoadMore} />)
    fireEvent.click(screen.getByRole('button', { name: /Settled/ }))
    fireEvent.scroll(document.querySelector('[data-settled-list]')!)
    expect(onLoadMore).not.toHaveBeenCalled()
  })
})
