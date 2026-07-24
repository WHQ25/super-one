/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CodexPermissionPresetList } from './CodexPermissionPresetList'

describe('CodexPermissionPresetList', () => {
  it('renders every preset and selects the requested value', () => {
    const onSelect = vi.fn()
    render(<CodexPermissionPresetList activePreset="default" onSelect={onSelect} />)

    expect(screen.getByRole('button', { name: /read-only/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^default/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /full access/i }))

    expect(onSelect).toHaveBeenCalledWith('full-access')
  })
})
