/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ConfigConfirmPayload } from '@superone/shared/agent-types'
import { ConfigConfirmPrompt } from './ConfigConfirmPrompt'

vi.mock('@/stores/settings', () => ({
  useSettingsStore: (selector: (s: unknown) => unknown) =>
    selector({ platforms: [], credentials: [], fetchProviderData: vi.fn() }),
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

describe('config confirm dialog — structured provider fields', () => {
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
})
