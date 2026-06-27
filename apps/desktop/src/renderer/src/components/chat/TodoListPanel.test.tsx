/** @vitest-environment jsdom */

import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TodoListPanel, type TodoListPanelItem } from './TodoListPanel'

function items(activeText: string): TodoListPanelItem[] {
  return [
    { id: '1', text: 'done', status: 'completed' },
    { id: '2', text: activeText, status: 'in_progress' },
    { id: '3', text: 'later', status: 'pending' },
  ]
}

describe('TodoListPanel auto-scroll to active task', () => {
  let scrollSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {})
  })

  afterEach(() => {
    scrollSpy.mockRestore()
  })

  it('scrolls to the in_progress task on first expand', () => {
    render(<TodoListPanel items={items('building')} expanded />)
    expect(scrollSpy).toHaveBeenCalledTimes(1)
  })

  it('does not scroll again when only the active task text streams in', () => {
    const { rerender } = render(<TodoListPanel items={items('build')} expanded />)
    expect(scrollSpy).toHaveBeenCalledTimes(1)

    rerender(<TodoListPanel items={items('building the')} expanded />)
    rerender(<TodoListPanel items={items('building the thing')} expanded />)

    expect(scrollSpy).toHaveBeenCalledTimes(1)
  })

  it('does not scroll on a new array reference with identical status structure', () => {
    const { rerender } = render(<TodoListPanel items={items('x')} expanded />)
    expect(scrollSpy).toHaveBeenCalledTimes(1)

    rerender(<TodoListPanel items={items('x')} expanded />)

    expect(scrollSpy).toHaveBeenCalledTimes(1)
  })

  it('scrolls again when the active task advances to the next item', () => {
    const { rerender } = render(<TodoListPanel items={items('a')} expanded />)
    expect(scrollSpy).toHaveBeenCalledTimes(1)

    rerender(
      <TodoListPanel
        items={[
          { id: '1', text: 'done', status: 'completed' },
          { id: '2', text: 'a', status: 'completed' },
          { id: '3', text: 'later', status: 'in_progress' },
        ]}
        expanded
      />,
    )

    expect(scrollSpy).toHaveBeenCalledTimes(2)
  })
})
