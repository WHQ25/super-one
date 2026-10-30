/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EnvironmentSettingsDialog } from './EnvironmentSettingsDialog'

function renderDialog(onSubmit = vi.fn(async () => {}), onOpenChange = vi.fn()) {
  render(
    <EnvironmentSettingsDialog
      open
      name="Mac"
      onOpenChange={onOpenChange}
      onSubmit={onSubmit}
    />,
  )
  const input = screen.getByRole('textbox', { name: 'Display Name' })
  fireEvent.change(input, { target: { value: 'Mac mini' } })
  return { input, onSubmit, onOpenChange }
}

describe('environment settings rename', () => {
  it('does not save on Enter while an IME composition is in progress', () => {
    const { input, onSubmit } = renderDialog()
    fireEvent.compositionStart(input)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(input).toHaveValue('Mac mini')
  })

  it('does not save on the legacy IME key code', () => {
    const { input, onSubmit } = renderDialog()
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(input).toHaveValue('Mac mini')
  })

  it('does not save the Enter that ends an IME composition', async () => {
    const { input, onSubmit } = renderDialog()
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

  it('keeps the dialog open when saving fails', async () => {
    const { input, onSubmit } = renderDialog(vi.fn(async () => { throw new Error('nope') }))
    fireEvent.change(input, { target: { value: 'studio' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      await Promise.resolve()
    })
    expect(onSubmit).toHaveBeenCalledWith('studio')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(input).toHaveValue('studio')
  })
})
