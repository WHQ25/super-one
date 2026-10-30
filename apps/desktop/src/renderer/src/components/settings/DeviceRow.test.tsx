/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DeviceRow } from './DeviceRow'

function renderRename(onSubmit = vi.fn()) {
  render(
    <DeviceRow
      kind="mac"
      name="Mac"
      online={false}
      removeLabel="Remove"
      onRemove={() => {}}
      rename={{ label: 'Rename', onSubmit }}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
  const input = screen.getByRole('textbox', { name: 'Rename' })
  fireEvent.change(input, { target: { value: 'Mac mini' } })
  return { input, onSubmit }
}

describe('device rename input', () => {
  it('does not save on Enter while an IME composition is in progress', () => {
    const { input, onSubmit } = renderRename()
    fireEvent.compositionStart(input)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(input).toHaveValue('Mac mini')
  })

  it('does not save on the legacy IME key code', () => {
    const { input, onSubmit } = renderRename()
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(input).toHaveValue('Mac mini')
  })

  it('does not save the Enter that ends an IME composition', async () => {
    const { input, onSubmit } = renderRename()
    fireEvent.compositionStart(input)
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.compositionEnd(input)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()

    await act(async () => { await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))) })
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
      await Promise.resolve()
    })
    expect(onSubmit).toHaveBeenCalledWith('Mac mini')
  })
})
