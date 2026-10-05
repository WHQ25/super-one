/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PermissionFeedbackInput } from './PermissionActionBar'
import { PermissionActionsLayout } from './PermissionActionsLayout'

let paneWidth: number
let resizeCallbacks: ResizeObserverCallback[]

function Review() {
  const [value, setValue] = useState('')
  return (
    <PermissionActionsLayout feedbackValue={value} feedback={
      <PermissionFeedbackInput value={value} onChange={setValue} onFocusChange={() => {}} placeholder="Feedback" onSubmit={() => {}} />
    }>
      <button>Approve</button><button>Reject</button>
    </PermissionActionsLayout>
  )
}

describe('permission feedback layout', () => {
  beforeEach(() => {
    paneWidth = 640
    resizeCallbacks = []
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { resizeCallbacks.push(callback) }
      observe() {}
      disconnect() {}
    })
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => paneWidth)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(() => 200)
    vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLTextAreaElement) {
      const width = Number.parseFloat(this.style.width) || paneWidth
      return this.value.split('\n').reduce((rows, line) => rows + Math.max(1, Math.ceil(line.length * 8 / width)), 0) * 16 + 12
    })
  })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it.each([
    { platform: 'darwin', shift: '⇧↵', alt: '⌥↵', altLabel: 'Option+Enter' },
    { platform: 'win32', shift: 'Shift+Enter', alt: 'Alt+Enter', altLabel: 'Alt+Enter' },
    { platform: 'linux', shift: 'Shift+Enter', alt: 'Alt+Enter', altLabel: 'Alt+Enter' },
  ])('renders newline keycaps for $platform', ({ platform, shift, alt, altLabel }) => {
    vi.stubGlobal('app', { platform })
    render(<Review />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'First\nSecond' } })
    expect(screen.getByLabelText('Shift+Enter').textContent).toBe(shift)
    expect(screen.getByLabelText(altLabel).textContent).toBe(alt)
  })

  it('uses the inline width after expanding and preserves the focused field when shrinking', () => {
    const { container } = render(<Review />)
    const layout = container.querySelector('[data-feedback-layout]')!
    const input = screen.getByRole('textbox') as HTMLTextAreaElement
    input.focus()
    fireEvent.change(input, { target: { value: 'x'.repeat(60) } })
    expect(layout.getAttribute('data-feedback-layout')).toBe('expanded')
    // This text would fit in the full-width row. Resizing that row must not collapse it.
    act(() => { resizeCallbacks.forEach((callback) => callback([], {} as ResizeObserver)) })
    expect(layout.getAttribute('data-feedback-layout')).toBe('expanded')
    expect(screen.getByRole('textbox')).toBe(input)
    expect(document.activeElement).toBe(input)
    fireEvent.change(input, { target: { value: 'Short feedback' } })
    expect(layout.getAttribute('data-feedback-layout')).toBe('inline')
    expect(document.activeElement).toBe(input)
  })

  it('expands explicit newlines and adapts to pane resizing without remounting the field', () => {
    const { container } = render(<Review />)
    const layout = container.querySelector('[data-feedback-layout]')!
    const input = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'First\nSecond' } })
    expect(layout.getAttribute('data-feedback-layout')).toBe('expanded')
    act(() => {
      paneWidth = 300
      resizeCallbacks.forEach((callback) => callback([], {} as ResizeObserver))
    })
    expect(layout.getAttribute('data-feedback-layout')).toBe('stacked')
    act(() => {
      paneWidth = 640
      resizeCallbacks.forEach((callback) => callback([], {} as ResizeObserver))
    })
    expect(layout.getAttribute('data-feedback-layout')).toBe('expanded')
    fireEvent.change(input, { target: { value: '' } })
    expect(layout.getAttribute('data-feedback-layout')).toBe('inline')
    expect(screen.getByRole('textbox')).toBe(input)
  })
})
