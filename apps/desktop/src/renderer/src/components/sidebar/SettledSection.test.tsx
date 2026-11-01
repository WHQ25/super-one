/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PinnedSessionEntry } from '@superone/shared/agent-types'
import { PROJECT_SETTLED_COLLAPSE_KEY, settledPanelId } from './sidebar-section-collapse'
import { SettledSection, type SettledSectionProps } from './SettledSection'

// jsdom has no layout, so the real virtualizer would render zero rows.
// The window is smaller than a loaded page, which is the point of virtualizing.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count, getItemKey }: { count: number; getItemKey?: (index: number) => unknown }) => {
    const visible = Math.min(count, 3)
    return {
      getTotalSize: () => count * 32,
      getVirtualItems: () => Array.from({ length: visible }, (_, index) => ({
        key: getItemKey?.(index) ?? index,
        index,
        start: index * 32,
        size: 32,
      })),
      measureElement: () => {},
    }
  },
}))

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
    expect(classTokens(header.querySelector('.lucide-circle-check'))).not.toContain('hidden')
    expect(classTokens(header.querySelector('.lucide-chevron-right'))).toContain('hidden')
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
    const chevron = classTokens(header.querySelector('.lucide-chevron-right'))
    expect(chevron).toContain('rotate-90')
    expect(chevron).not.toContain('hidden')
    expect(classTokens(header.querySelector('.lucide-circle-check'))).toContain('hidden')
    const panel = document.getElementById(settledPanelId(FOLDER))
    expect(panel).not.toHaveAttribute('hidden')
    expect(panel?.querySelector('.group\\/session')).not.toBeNull()
    expect(panel?.querySelector('.group\\/pin')).toBeNull()
    expect(panel).toHaveTextContent('Finished review')
    expect(document.querySelector('[data-slot="settled-divider"]')).toBeNull()
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
    const list = document.querySelector('[data-settled-list] [data-slot="scroll-area-viewport"]')
    expect(list).not.toBeNull()
    expect(list).toHaveClass('scroll-edge-fade-y')
    expect(document.querySelector('[data-settled-list]')).toHaveClass('max-h-64')
    fireEvent.scroll(list!)
    expect(onLoadMore).toHaveBeenCalledTimes(1)
    fireEvent.scroll(list!)
    expect(onLoadMore).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Show More' })).toBeNull()
  })

  it('mounts only the virtual window, not every loaded row', () => {
    const sessions = Array.from({ length: 8 }, (_, index) => ({
      ...session(`Finished ${index}`),
      sessionId: `sid-${index}`,
    }))
    render(<SettledSection {...props} sessions={sessions} />)
    fireEvent.click(screen.getByRole('button', { name: /Settled/ }))
    expect(screen.getByText('Finished 0')).toBeInTheDocument()
    expect(screen.getByText('Finished 2')).toBeInTheDocument()
    expect(screen.queryByText('Finished 3')).toBeNull()
    expect(document.querySelectorAll('.group\\/session')).toHaveLength(3)
  })

  it('does not ask for another page when the list is complete', () => {
    const onLoadMore = vi.fn()
    render(<SettledSection {...props} sessions={[session('Finished review')]} onLoadMore={onLoadMore} />)
    fireEvent.click(screen.getByRole('button', { name: /Settled/ }))
    fireEvent.scroll(document.querySelector('[data-settled-list]')!)
    expect(onLoadMore).not.toHaveBeenCalled()
  })
})

function classTokens(node: Element | null): string[] {
  return (node?.getAttribute('class') ?? '').split(/\s+/)
}
