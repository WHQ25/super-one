/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SidebarSectionLabel } from './SidebarSectionLabel'

describe('SidebarSectionLabel', () => {
  it('folds on click and shows the hidden count only while folded', () => {
    const onToggle = vi.fn()
    const { rerender } = render(
      <SidebarSectionLabel section="pinned" count={3} collapsed={false} onToggle={onToggle}>
        Pinned
      </SidebarSectionLabel>,
    )

    const header = screen.getByRole('button', { name: 'Pinned' })
    expect(header).toHaveAttribute('aria-expanded', 'true')
    expect(header.querySelector('[data-slot="section-count"]')).toBeNull()
    expect(header.querySelector('.lucide-pin')?.getAttribute('class')).toContain('group-hover:hidden')
    const openChevron = header.querySelector('.lucide-chevron-right')?.getAttribute('class') ?? ''
    expect(openChevron).toContain('hidden')
    expect(openChevron).toContain('group-hover:block')
    expect(openChevron).toContain('rotate-90')

    fireEvent.click(header)
    expect(onToggle).toHaveBeenCalledOnce()

    rerender(
      <SidebarSectionLabel section="pinned" count={3} collapsed onToggle={onToggle}>
        Pinned
      </SidebarSectionLabel>,
    )
    expect(screen.getByRole('button', { name: 'Pinned 3' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button').querySelector('[data-slot="section-count"]')).toHaveTextContent('3')
  })

  it('keeps a long title from pushing the count off a narrow row', () => {
    render(
      <div className="w-40">
        <SidebarSectionLabel section="drafts" count={12} collapsed onToggle={() => {}}>
          Drafts with a very long section title
        </SidebarSectionLabel>
      </div>,
    )
    expect(screen.getByText('Drafts with a very long section title')).toHaveClass('truncate')
    expect(screen.getByText('12')).toBeInTheDocument()
    const header = screen.getByRole('button')
    expect(header.querySelector('.lucide-notebook-pen')).not.toBeNull()
    expect(header.querySelector('.lucide-chevron-right')?.getAttribute('class')).not.toContain('rotate-90')
  })

  it('keeps the down chevron in the slot while a settled group is open', () => {
    const { rerender } = render(
      <SidebarSectionLabel section="settled" count={4} collapsed chevronWhenExpanded onToggle={() => {}}>
        Settled
      </SidebarSectionLabel>,
    )
    const folded = screen.getByRole('button')
    expect(classTokens(folded.querySelector('.lucide-circle-check'))).not.toContain('hidden')
    expect(classTokens(folded.querySelector('.lucide-chevron-right'))).toContain('hidden')

    rerender(
      <SidebarSectionLabel section="settled" count={4} collapsed={false} chevronWhenExpanded onToggle={() => {}}>
        Settled
      </SidebarSectionLabel>,
    )
    const open = screen.getByRole('button', { name: 'Settled' })
    expect(classTokens(open.querySelector('.lucide-circle-check'))).toContain('hidden')
    const chevron = classTokens(open.querySelector('.lucide-chevron-right'))
    expect(chevron).toContain('rotate-90')
    expect(chevron).toContain('block')
    expect(chevron).not.toContain('hidden')
  })
})

function classTokens(node: Element | null): string[] {
  return (node?.getAttribute('class') ?? '').split(/\s+/)
}
