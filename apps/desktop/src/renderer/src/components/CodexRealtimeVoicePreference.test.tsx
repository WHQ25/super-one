/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CodexRealtimeVoicePreference } from './CodexRealtimeVoicePreference'

describe('CodexRealtimeVoicePreference', () => {
  const listVoices = vi.fn(async () => ({
    voices: ['juniper', 'cove'],
    defaultVoice: 'cove',
  }))

  beforeEach(() => {
    listVoices.mockClear()
    Object.defineProperty(window, 'app', {
      configurable: true,
      value: {
        codexListRealtimeVoices: listVoices,
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists only concrete voices and persists the chosen voice', async () => {
    const onChange = vi.fn(async () => {})
    render(
      <CodexRealtimeVoicePreference
        projectPath="/repo"
        value=""
        onChange={onChange}
      />,
    )

    await waitFor(() => expect(listVoices).toHaveBeenCalledWith('/repo'))
    const trigger = screen.getByText(/Cove/).closest('button')
    expect(trigger).not.toBeNull()
    fireEvent.click(trigger!)

    expect(screen.queryByText(/Codex default|Codex 默认/)).toBeNull()
    expect(screen.queryByRole('button', { name: /Preview|试听/ })).toBeNull()
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('Juniper').closest('button')!)
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('juniper'))
  })
})
