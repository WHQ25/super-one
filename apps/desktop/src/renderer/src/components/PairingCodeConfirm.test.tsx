/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PairingCodeConfirm } from './PairingCodeConfirm'

function renderForm(overrides: Partial<Parameters<typeof PairingCodeConfirm>[0]> = {}) {
  const props = {
    deviceName: 'iPhone',
    onDeviceNameChange: vi.fn(),
    code: '',
    onCodeChange: vi.fn(),
    error: '',
    confirming: false,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  }
  render(<PairingCodeConfirm {...props} />)
  return props
}

describe('PairingCodeConfirm', () => {
  it('shows the phone-suggested name and keeps confirm disabled until six digits', () => {
    renderForm({ deviceName: 'Google Pixel 8' })
    expect(screen.getByDisplayValue('Google Pixel 8')).toBeTruthy()
    expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled()
  })

  it('reports name edits and digits-only code input', () => {
    const props = renderForm()
    fireEvent.change(screen.getByDisplayValue('iPhone'), { target: { value: "Hangqi's iPhone" } })
    expect(props.onDeviceNameChange).toHaveBeenCalledWith("Hangqi's iPhone")
    fireEvent.change(screen.getByPlaceholderText('000000'), { target: { value: '12ab34' } })
    expect(props.onCodeChange).toHaveBeenCalledWith('1234')
  })

  it('confirms once six digits are present', () => {
    const props = renderForm({ code: '123456' })
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    expect(props.onConfirm).toHaveBeenCalled()
  })
})
