/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdaptiveContextMenu } from '@/components/AdaptiveContextMenu'
import { SessionHoverCardTrigger, SidebarHoverCard, sidebarHoverCardPlacement, sidebarHoverCardRowClass } from './SidebarHoverCard'

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

  it('closes as soon as the sidebar scrolls under the pointer', () => {
    vi.useFakeTimers()
    render(
      <div data-sidebar-outer="">
        <div data-testid="session-list">
          <SidebarHoverCard content={<div>card body</div>}>
            <SessionHoverCardTrigger>
              <div className={sidebarHoverCardRowClass}>Session row</div>
            </SessionHoverCardTrigger>
          </SidebarHoverCard>
        </div>
      </div>,
    )

    const row = screen.getByText('Session row')
    fireEvent.pointerEnter(row)
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(row).toHaveAttribute('data-sidebar-hover-open', 'true')

    fireEvent.scroll(screen.getByTestId('session-list'))
    expect(row).not.toHaveAttribute('data-sidebar-hover-open')
  })

  it('stays open when the chat transcript scrolls', () => {
    vi.useFakeTimers()
    render(
      <>
        <div data-sidebar-outer="">
          <SidebarHoverCard content={<div>card body</div>}>
            <SessionHoverCardTrigger>
              <div className={sidebarHoverCardRowClass}>Session row</div>
            </SessionHoverCardTrigger>
          </SidebarHoverCard>
        </div>
        <div data-testid="chat-transcript" />
      </>,
    )

    const row = screen.getByText('Session row')
    fireEvent.pointerEnter(row)
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(row).toHaveAttribute('data-sidebar-hover-open', 'true')

    fireEvent.scroll(screen.getByTestId('chat-transcript'))
    expect(row).toHaveAttribute('data-sidebar-hover-open', 'true')
  })

  it('keeps the card open while its own content scrolls', () => {
    vi.useFakeTimers()
    render(
      <div data-sidebar-outer="">
        <SidebarHoverCard content={<div data-testid="card-scroll">card body</div>}>
          <SessionHoverCardTrigger>
            <div className={sidebarHoverCardRowClass}>Session row</div>
          </SessionHoverCardTrigger>
        </SidebarHoverCard>
      </div>,
    )

    const row = screen.getByText('Session row')
    fireEvent.pointerEnter(row)
    act(() => {
      vi.advanceTimersByTime(300)
    })
    fireEvent.scroll(screen.getByTestId('card-scroll'))
    expect(row).toHaveAttribute('data-sidebar-hover-open', 'true')
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

describe('sidebar hover card placement', () => {
  const viewportHeight = 800

  it('stays on the row top when the card fits in the window', () => {
    expect(sidebarHoverCardPlacement({
      rowTop: 120,
      cardHeight: 140,
      scrollHeight: 140,
      viewportHeight,
    })).toEqual({ offset: 0, maxHeight: null })
  })

  it('slides the card up when the row sits on the bottom edge', () => {
    // 160px card, 8px pad: the lowest top that still fits is 800 - 8 - 160.
    expect(sidebarHoverCardPlacement({
      rowTop: 740,
      cardHeight: 160,
      scrollHeight: 160,
      viewportHeight,
    })).toEqual({ offset: -(740 - (viewportHeight - 8 - 160)), maxHeight: null })
  })

  it('slides the card down when the row is above the window', () => {
    expect(sidebarHoverCardPlacement({
      rowTop: -30,
      cardHeight: 100,
      scrollHeight: 100,
      viewportHeight,
    })).toEqual({ offset: 8 - (-30), maxHeight: null })
  })

  it('caps a card taller than the window and pins it to the top pad', () => {
    const available = viewportHeight - 16
    expect(sidebarHoverCardPlacement({
      rowTop: 640,
      cardHeight: 2000,
      scrollHeight: 2000,
      viewportHeight,
    })).toEqual({ offset: Math.floor(8 - 640), maxHeight: available })
  })

  it('rounds a fractional upward slide away from the bottom edge', () => {
    const placed = sidebarHoverCardPlacement({
      rowTop: 740.6,
      cardHeight: 160,
      scrollHeight: 160,
      viewportHeight,
    })
    const top = 740.6 + placed.offset
    expect(top + 160).toBeLessThanOrEqual(viewportHeight - 8)
    expect(placed.offset).toBeLessThan(0)
    expect(placed.maxHeight).toBeNull()
  })

  it('moves the open card up inside the window and keeps it on the right', async () => {
    const height = vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(viewportHeight)
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const el = this as HTMLElement
      if (el.dataset.sidebarHoverOpen === 'true') return new DOMRect(0, 740, 260, 36)
      if (el.dataset.slot === 'hover-card-content') return new DOMRect(264, 740, 288, 160)
      return new DOMRect(0, 0, 8, 8)
    })
    try {
      render(
        <SidebarHoverCard open content={<div>card body</div>}>
          <SessionHoverCardTrigger>
            <div className={sidebarHoverCardRowClass}>Offline host</div>
          </SessionHoverCardTrigger>
        </SidebarHoverCard>,
      )

      const content = document.querySelector<HTMLElement>('[data-slot="hover-card-content"]')
      const wrapper = content?.parentElement as HTMLElement | undefined
      // Row top 740, card 160, pad 8 → top 632. Stays to the right of the 260px row.
      await waitFor(() => {
        expect(wrapper?.style.transform).toBe('translate(264px, 632px)')
      })
      expect(content).toHaveAttribute('data-side', 'right')
      expect(content).toHaveAttribute('data-align', 'start')
      expect(content?.style.maxHeight).toBe('')
    } finally {
      rect.mockRestore()
      height.mockRestore()
    }
  })
})
