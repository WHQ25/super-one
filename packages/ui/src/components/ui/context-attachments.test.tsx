/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ContextAttachments } from './context-attachments'

afterEach(cleanup)
describe('shared context attachment chips', () => {
  it('shows the label, previews plain text safely, and removes the selected item only', () => {
    const remove = vi.fn()
    render(<ContextAttachments items={[{ id: 'part', title: 'Dial', source: 'CAD', content: '<script>run()</script>' }, { id: 'other', title: 'Gear' }]} onRemove={remove} />)
    expect(screen.queryByText('<script>run()</script>')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Dial' }))
    expect(screen.getByText('<script>run()</script>')).toBeTruthy()
    expect(document.querySelector('script')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Remove attachment: Gear' }))
    expect(remove).toHaveBeenCalledExactlyOnceWith('other')
  })
  it('has an empty state, exposes removal progress, and keeps errors visible', () => {
    const s = render(<ContextAttachments items={[]} />)
    expect(s.container.textContent).toBe('')
    s.rerender(<ContextAttachments items={[{ id: 'part', title: 'Dial' }]} onRemove={() => {}} removing={['part']} error="Host disconnected" />)
    expect(screen.getByRole('button', { name: 'Remove attachment: Dial' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('alert').textContent).toBe('Host disconnected')
  })
})
