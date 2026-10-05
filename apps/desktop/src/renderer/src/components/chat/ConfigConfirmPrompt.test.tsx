/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ConfigConfirmPayload } from '@superone/shared/agent-types'
import { ConfigConfirmPrompt } from './ConfigConfirmPrompt'

vi.mock('@/stores/settings', () => ({
  useSettingsStore: (selector: (s: unknown) => unknown) =>
    selector({ platforms: [], credentials: [], fetchProviderData: vi.fn() }),
}))

vi.mock('@/stores/app', () => ({
  useAppStore: (selector: (s: unknown) => unknown) =>
    selector({ terminalFontSize: 14, terminalFontFamily: null }),
}))

// Heavy preview widgets — assert wiring via friendly names, not xterm/mermaid paint.
vi.mock('@/components/coding/TerminalThemePreview', () => ({
  TerminalThemePreview: () => <div data-testid="terminal-theme-preview" />,
}))
vi.mock('@/components/chat/MermaidThemePreview', () => ({
  MermaidThemePreview: () => <div data-testid="mermaid-theme-preview" />,
}))

function envPayload(): ConfigConfirmPayload {
  return {
    resource: {
      resource: 'custom-platform',
      operation: 'update',
      recordId: 'custom:relay',
      title: 'My Relay',
      subtitle: 'custom',
      context: { platformId: 'custom:relay', planId: 'api' },
      fields: [
        {
          key: 'extraEnv',
          domain: 'custom-platform',
          label: 'Environment Variables',
          type: 'env',
          currentValue: { KEEP_ME: '1', API_TIMEOUT_MS: '60000' },
          proposedValue: { API_TIMEOUT_MS: '120000' },
        },
      ],
    },
  }
}

describe('config confirm dialog — appearance theme previews', () => {
  it('reuses terminal + mermaid pickers with live previews for palette/theme fields', () => {
    const onConfirm = vi.fn()
    render(
      <ConfigConfirmPrompt
        payload={{
          fields: [
            {
              key: 'terminalDarkPalette',
              domain: 'appearance',
              label: 'Terminal Dark Palette',
              type: 'enum',
              enumValues: ['dracula', 'nord'],
              clearable: true,
              currentValue: null,
              proposedValue: 'dracula',
            },
            {
              key: 'mermaidLightTheme',
              domain: 'appearance',
              label: 'Mermaid Light Theme',
              type: 'enum',
              enumValues: ['default', 'forest'],
              clearable: true,
              currentValue: null,
              proposedValue: 'forest',
            },
          ],
        }}
        onConfirm={onConfirm}
        onReject={vi.fn()}
      />,
    )

    expect(screen.getByTestId('terminal-theme-preview')).toBeInTheDocument()
    expect(screen.getByTestId('mermaid-theme-preview')).toBeInTheDocument()
    // Friendly names from the shared pickers — not raw enum ids as the only control.
    expect(screen.getByRole('button', { name: /Dracula/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Forest/i })).toBeInTheDocument()
  })
})

describe('config confirm dialog — structured provider fields', () => {
  it('edits descriptive fields across lines while keeping identifiers single-line', () => {
    const onConfirm = vi.fn()
    const onReject = vi.fn()
    render(<ConfigConfirmPrompt payload={{ fields: [
      { key: 'notes', domain: 'credential', label: 'Notes', type: 'string', currentValue: '', proposedValue: 'Team credential' },
      { key: 'name', domain: 'credential', label: 'Name', type: 'string', currentValue: '', proposedValue: 'Production' },
    ] }} onConfirm={onConfirm} onReject={onReject} />)
    const notes = screen.getByRole('textbox', { name: 'Notes' }) as HTMLTextAreaElement
    expect(notes.tagName).toBe('TEXTAREA')
    expect(screen.getByDisplayValue('Production').tagName).toBe('INPUT')
    notes.focus()
    notes.setSelectionRange(notes.value.length, notes.value.length)
    fireEvent.keyDown(notes, { key: 'Enter', altKey: true })
    fireEvent.change(notes, { target: { value: `${notes.value}Shared with the build service` } })
    fireEvent.keyDown(notes, { key: 'Enter' })
    expect(onReject).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Confirm & Apply/ }))
    expect(onConfirm).toHaveBeenCalledWith({ notes: 'Team credential\nShared with the build service', name: 'Production' })
  })

  it('inserts newlines in reject feedback without rejecting the configuration', () => {
    const onReject = vi.fn()
    render(<ConfigConfirmPrompt payload={envPayload()} onConfirm={vi.fn()} onReject={onReject} />)
    const feedback = screen.getByPlaceholderText(/feedback/i) as HTMLTextAreaElement
    feedback.focus()
    fireEvent.change(feedback, { target: { value: 'Keep the timeout' } })
    feedback.setSelectionRange(feedback.value.length, feedback.value.length)
    fireEvent.keyDown(feedback, { key: 'Enter', shiftKey: true })
    fireEvent.change(feedback, { target: { value: `${feedback.value}Keep the existing variables` } })
    expect(onReject).not.toHaveBeenCalled()
    fireEvent.keyDown(feedback, { key: 'Enter' })
    expect(onReject).toHaveBeenCalledWith('Keep the timeout\nKeep the existing variables')
  })

  it('edits an env override through the settings env table instead of a JSON blob', () => {
    const onConfirm = vi.fn()
    render(<ConfigConfirmPrompt payload={envPayload()} onConfirm={onConfirm} onReject={vi.fn()} />)

    // The env editor renders one KEY/value input pair per entry — no JSON textarea anywhere.
    expect(screen.queryByRole('textbox', { name: /json/i })).toBeNull()
    const keyInput = screen.getByDisplayValue('API_TIMEOUT_MS')
    expect(keyInput).toBeInTheDocument()
    expect(screen.getByDisplayValue('120000')).toBeInTheDocument()

    fireEvent.change(screen.getByDisplayValue('120000'), { target: { value: '90000' } })
    fireEvent.click(screen.getByRole('button', { name: /Confirm & Apply/ }))

    expect(onConfirm).toHaveBeenCalledWith({ extraEnv: { API_TIMEOUT_MS: '90000' } })
  })

  it('summarizes the change as a key-level diff rather than two maps', () => {
    render(<ConfigConfirmPrompt payload={envPayload()} onConfirm={vi.fn()} onReject={vi.fn()} />)

    expect(screen.getByText('API_TIMEOUT_MS 60000 → 120000, −KEEP_ME')).toBeInTheDocument()
  })

  it('allows reject without feedback', () => {
    const onReject = vi.fn()
    render(<ConfigConfirmPrompt payload={envPayload()} onConfirm={vi.fn()} onReject={onReject} />)

    const rejectBtn = screen.getByRole('button', { name: /Reject/i })
    expect(rejectBtn).not.toBeDisabled()
    fireEvent.click(rejectBtn)
    expect(onReject).toHaveBeenCalledWith('')
  })
})
