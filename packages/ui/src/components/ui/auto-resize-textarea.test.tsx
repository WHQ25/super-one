/** @vitest-environment jsdom */
import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AutoResizeTextarea } from './auto-resize-textarea'

function Editor({ submit, maxLength }: { submit: (value: string) => void; maxLength?: number }) {
  const [value, setValue] = useState('first last')
  return <AutoResizeTextarea aria-label="Feedback" value={value} onValueChange={setValue} onSubmit={() => submit(value)} maxLength={maxLength} />
}

describe('auto-resizing text entry', () => {
  it('keeps an empty field at one row even when its placeholder wraps', () => {
    const scrollHeight = vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockReturnValue(76)
    const props = { 'aria-label': 'Feedback', onValueChange: vi.fn(), placeholder: 'A long placeholder', style: { lineHeight: '16px', fontSize: '12px', padding: '6px 8px', border: 0 } }
    const view = render(<AutoResizeTextarea {...props} value="" />)
    const input = screen.getByRole('textbox')
    expect(input.style.height).toBe('28px')
    view.rerender(<AutoResizeTextarea {...props} value="Long feedback" />)
    expect(input.style.height).toBe('76px')
    view.rerender(<AutoResizeTextarea {...props} value="" />)
    expect(input.style.height).toBe('28px')
    scrollHeight.mockRestore()
  })

  it.each([{ shiftKey: true }, { altKey: true }])('replaces selected text with a newline and preserves the caret %j', (modifier) => {
    const submit = vi.fn()
    render(<Editor submit={submit} />)
    const input = screen.getByRole('textbox') as HTMLTextAreaElement
    input.focus()
    input.setSelectionRange(5, 6)
    fireEvent.keyDown(input, { key: 'Enter', ...modifier })
    expect(input.value).toBe('first\nlast')
    expect(input.selectionStart).toBe(6)
    expect(input.selectionEnd).toBe(6)
    expect(submit).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(submit).toHaveBeenCalledExactlyOnceWith('first\nlast')
  })

  it('leaves IME Enter to composition and does not submit', () => {
    const submit = vi.fn()
    render(<Editor submit={submit} />)
    const input = screen.getByRole('textbox')
    expect(fireEvent.keyDown(input, { key: 'Enter', isComposing: true })).toBe(true)
    expect(submit).not.toHaveBeenCalled()
    expect(input).toHaveValue('first last')
  })

  it('respects the length limit when manually inserting a newline', () => {
    render(<Editor submit={vi.fn()} maxLength={10} />)
    const input = screen.getByRole('textbox') as HTMLTextAreaElement
    input.focus()
    input.setSelectionRange(10, 10)
    fireEvent.keyDown(input, { key: 'Enter', altKey: true })
    expect(input.value).toBe('first last')
    input.setSelectionRange(5, 6)
    fireEvent.keyDown(input, { key: 'Enter', altKey: true })
    expect(input.value).toBe('first\nlast')
  })
})
