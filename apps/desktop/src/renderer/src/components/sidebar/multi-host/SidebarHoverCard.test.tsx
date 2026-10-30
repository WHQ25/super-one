/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdaptiveContextMenu } from '@/components/AdaptiveContextMenu'
import { SessionHoverCardTrigger, SidebarHoverCard, sidebarHoverCardRowClass } from './SidebarHoverCard'

describe('sidebar hover card row highlight', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('keeps the row marked open while the pointer is on the card', () => {
    vi.useFakeTimers()
    render(
      <SidebarHoverCard content={<div>card body</div>}>
        <AdaptiveContextMenu items={[]}>
          <SessionHoverCardTrigger>
            <div className={sidebarHoverCardRowClass}>Session row</div>
          </SessionHoverCardTrigger>
        </AdaptiveContextMenu>
      </SidebarHoverCard>,
    )

    const row = screen.getByText('Session row')
    expect(row.className).toContain('hover:bg-sidebar-hover')
    expect(row.className).toContain('data-[sidebar-hover-open=true]:bg-sidebar-hover')
    expect(row).not.toHaveAttribute('data-sidebar-hover-open')

    fireEvent.pointerEnter(row)
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(row).toHaveAttribute('data-sidebar-hover-open', 'true')

    const card = screen.getByText('card body')
    fireEvent.pointerLeave(row)
    fireEvent.pointerEnter(card)
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(row).toHaveAttribute('data-sidebar-hover-open', 'true')

    fireEvent.pointerLeave(card)
    act(() => {
      vi.advanceTimersByTime(149)
    })
    expect(row).toHaveAttribute('data-sidebar-hover-open', 'true')
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(row).not.toHaveAttribute('data-sidebar-hover-open')
  })

  it('marks a pinned-open row before the pointer arrives', () => {
    render(
      <SidebarHoverCard open content={<div>card body</div>}>
        <SessionHoverCardTrigger>
          <div className={sidebarHoverCardRowClass}>Project row</div>
        </SessionHoverCardTrigger>
      </SidebarHoverCard>,
    )
    expect(screen.getByText('Project row')).toHaveAttribute('data-sidebar-hover-open', 'true')
  })
})
