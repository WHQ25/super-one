/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ActiveSessionList } from './ActiveSessionList'

describe('ActiveSessionList', () => {
  it('loads the next page when the list is scrolled near the bottom', () => {
    const onLoadMore = vi.fn(async () => {})
    render(
      <ActiveSessionList hasMore onLoadMore={onLoadMore}>
        <div>Recent session</div>
      </ActiveSessionList>,
    )
    const list = document.querySelector('[data-active-session-list]')
    expect(list).not.toBeNull()
    expect(list).toHaveClass('max-h-64')
    expect(list).not.toHaveClass('max-h-96')
    const viewport = list!.querySelector('[data-slot="scroll-area-viewport"]')
    expect(viewport).not.toBeNull()
    expect(viewport).toHaveClass('scroll-edge-fade-y')
    expect(list?.className).toContain('overscroll-contain')
    fireEvent.scroll(viewport!)
    expect(onLoadMore).toHaveBeenCalledTimes(1)
    fireEvent.scroll(viewport!)
    expect(onLoadMore).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Show More' })).toBeNull()
  })

  it('uses a project-focus cap in place of the shared one', () => {
    render(
      <ActiveSessionList maxHeight={480}>
        <div>Focused session</div>
      </ActiveSessionList>,
    )
    const list = document.querySelector('[data-active-session-list]') as HTMLElement
    expect(list.style.maxHeight).toBe('480px')
    expect(list).toHaveClass('max-h-64')
  })

  it('fills the focus pane instead of keeping the height cap', () => {
    render(
      <ActiveSessionList layout="fill">
        <div>Focused session</div>
      </ActiveSessionList>,
    )
    const list = document.querySelector('[data-active-session-list]')
    expect(list).toHaveClass('h-full')
    expect(list).not.toHaveClass('max-h-64')
    expect(list).not.toHaveClass('max-h-36')
  })

  it('scrolls a child list separately from the active list', () => {
    const onLoadMore = vi.fn()
    render(
      <ActiveSessionList kind="child" hasMore onLoadMore={onLoadMore}>
        <div>Child session</div>
      </ActiveSessionList>,
    )
    const list = document.querySelector('[data-child-session-list]')
    expect(list).not.toBeNull()
    expect(list).toHaveClass('max-h-36')
    expect(list).not.toHaveClass('max-h-64')
    expect(document.querySelector('[data-active-session-list]')).toBeNull()
    fireEvent.scroll(list!.querySelector('[data-slot="scroll-area-viewport"]')!)
    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })

  it('does not ask for another page when the list is complete', () => {
    const onLoadMore = vi.fn()
    render(
      <ActiveSessionList onLoadMore={onLoadMore}>
        <div>Recent session</div>
      </ActiveSessionList>,
    )
    expect(screen.getByText('Recent session')).toBeInTheDocument()
    fireEvent.scroll(document.querySelector('[data-active-session-list] [data-slot="scroll-area-viewport"]')!)
    expect(onLoadMore).not.toHaveBeenCalled()
  })

  it('mounts the visible window from the real virtualizer, not every row', () => {
    const offsetHeight = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.slot === 'scroll-area-viewport' ? 256 : 32
    })
    const offsetWidth = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(240)
    render(
      <ActiveSessionList>
        {Array.from({ length: 40 }, (_, index) => <div key={index}>Active {index}</div>)}
      </ActiveSessionList>,
    )
    expect(screen.getByText('Active 0')).toBeInTheDocument()
    expect(screen.queryByText('Active 39')).toBeNull()
    expect(document.querySelectorAll('[data-index]').length).toBeLessThan(20)
    offsetHeight.mockRestore()
    offsetWidth.mockRestore()
  })

  it('continues a wheel into the sidebar when the list is already at the top', () => {
    const { container } = render(
      <div data-sidebar-scroll="" style={{ overflowY: 'scroll' }}>
        <ActiveSessionList>
          <div>Recent session</div>
        </ActiveSessionList>
      </div>,
    )
    const sidebar = container.querySelector('[data-sidebar-scroll]') as HTMLElement
    const viewport = container.querySelector('[data-slot="scroll-area-viewport"]') as HTMLElement
    defineScroll(viewport, { scrollHeight: 400, clientHeight: 100, scrollTop: 0 })
    defineScroll(sidebar, { scrollHeight: 800, clientHeight: 200, scrollTop: 80 })
    fireEvent.wheel(viewport, { deltaY: -30 })
    expect(sidebar.scrollTop).toBe(50)
  })
})

function defineScroll(el: HTMLElement, metrics: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: metrics.scrollHeight })
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: metrics.clientHeight })
  let top = metrics.scrollTop
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (value: number) => { top = value },
  })
}
