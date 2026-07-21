/** @vitest-environment jsdom */

import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SettingField, type SettingFieldValue } from './SettingField'

// Radix's DropdownMenu opens on pointerdown, which jsdom + fireEvent.click doesn't simulate
// reliably. Mirrors the mock used by AppSidebar.test.tsx for the same primitive.
vi.mock('@superone/ui/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuItem: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
}))

describe('SettingField', () => {
  it('binds a boolean field to a Switch and reports toggles', () => {
    const onChange = vi.fn<(value: SettingFieldValue) => void>()
    render(<SettingField field={{ key: 'liquidGlass', label: 'Liquid Glass', type: 'boolean' }} value={false} onChange={onChange} />)

    fireEvent.click(screen.getByRole('switch'))

    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('lists enum options in a dropdown and reports the selected value', () => {
    const onChange = vi.fn<(value: SettingFieldValue) => void>()
    render(
      <SettingField
        field={{ key: 'updateChannel', label: 'Update Channel', type: 'enum', enumValues: ['alpha', 'beta', 'stable'], clearable: true }}
        value="alpha"
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByText('stable'))

    expect(onChange).toHaveBeenCalledWith('stable')
  })

  it('resets a clearable enum field to null via the default option', () => {
    const onChange = vi.fn<(value: SettingFieldValue) => void>()
    render(
      <SettingField
        field={{ key: 'updateChannel', label: 'Update Channel', type: 'enum', enumValues: ['alpha', 'beta'], clearable: true }}
        value="alpha"
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByText('Default'))

    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('clamps a number field to an empty string back to null when clearable', () => {
    const onChange = vi.fn<(value: SettingFieldValue) => void>()
    render(
      <SettingField
        field={{ key: 'terminalFontSize', label: 'Terminal Font Size', type: 'number', min: 12, max: 22, clearable: true }}
        value={14}
        onChange={onChange}
      />,
    )

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '' } })

    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('reports raw string edits for a string field', () => {
    const onChange = vi.fn<(value: SettingFieldValue) => void>()
    render(<SettingField field={{ key: 'uiFontFamily', label: 'UI Font', type: 'string' }} value="Inter" onChange={onChange} />)

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Menlo' } })

    expect(onChange).toHaveBeenCalledWith('Menlo')
  })

  it('renders a json field as a textarea passing raw text through onChange', () => {
    const onChange = vi.fn<(value: SettingFieldValue) => void>()
    render(<SettingField field={{ key: 'schedule', label: 'Schedule', type: 'json' }} value='{"type":"recurring"}' onChange={onChange} />)

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: '{"type":"one-time"}' } })

    expect(onChange).toHaveBeenCalledWith('{"type":"one-time"}')
  })
})
