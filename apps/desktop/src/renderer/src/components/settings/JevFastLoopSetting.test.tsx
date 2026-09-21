/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Radix Switch drives pointer capture, which jsdom does not implement.
Object.defineProperties(HTMLElement.prototype, {
  hasPointerCapture: { configurable: true, value: () => false },
  setPointerCapture: { configurable: true, value: () => {} },
  releasePointerCapture: { configurable: true, value: () => {} },
})

const getAppSettings = vi.fn()
const saveAppSettings = vi.fn()
const getJevApiKeyStatus = vi.fn()
const setJevApiKey = vi.fn()

Object.defineProperty(window, 'app', {
  configurable: true,
  value: { getAppSettings, saveAppSettings, getJevApiKeyStatus, setJevApiKey },
})

const { JevFastLoopSetting } = await import('./JevFastLoopSetting')

function settings(overrides: Record<string, unknown> = {}) {
  return { jevFastLoopEnabled: false, ...overrides }
}

async function renderSetting(overrides: Record<string, unknown> = {}) {
  getAppSettings.mockResolvedValue(settings(overrides))
  const view = render(<JevFastLoopSetting />)
  await waitFor(() => expect(jevSwitch().getAttribute('data-disabled')).toBeNull())
  return view
}

function jevSwitch(): HTMLElement {
  const row = screen.getByText('Jev Fast Inner Loop').closest('.flex')
  return row!.querySelector('[role="switch"]') as HTMLElement
}

beforeEach(() => {
  getAppSettings.mockReset()
  saveAppSettings.mockReset()
  getJevApiKeyStatus.mockReset()
  getJevApiKeyStatus.mockResolvedValue({ configured: false, masked: '' })
  setJevApiKey.mockReset()
})

describe('JevFastLoopSetting', () => {
  it('asks for a key instead of enabling when none is stored, then enables once the key is saved', async () => {
    await renderSetting()
    fireEvent.click(jevSwitch())

    const input = await screen.findByLabelText('Jev API Key')
    expect(saveAppSettings).not.toHaveBeenCalled()
    expect(jevSwitch().getAttribute('data-state')).toBe('unchecked')

    setJevApiKey.mockResolvedValue({ configured: true, masked: '***abc123' })
    saveAppSettings.mockResolvedValue(settings({ jevFastLoopEnabled: true }))
    fireEvent.change(input, { target: { value: 'ts-secret-abc123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Key' }))

    await waitFor(() => expect(saveAppSettings).toHaveBeenCalledWith({ jevFastLoopEnabled: true }))
    expect(setJevApiKey).toHaveBeenCalledWith('ts-secret-abc123')
    expect(await screen.findByText('***abc123')).toBeInTheDocument()
    expect(jevSwitch().getAttribute('data-state')).toBe('checked')
  })

  it('toggles directly and shows the masked key when one is already stored', async () => {
    getJevApiKeyStatus.mockResolvedValue({ configured: true, masked: '***zz9999' })
    await renderSetting()
    saveAppSettings.mockResolvedValue(settings({ jevFastLoopEnabled: true }))
    fireEvent.click(jevSwitch())

    await waitFor(() => expect(saveAppSettings).toHaveBeenCalledWith({ jevFastLoopEnabled: true }))
    expect(await screen.findByText('***zz9999')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change Key' })).toBeInTheDocument()
  })

  it('surfaces a refused key store without enabling the loop', async () => {
    await renderSetting()
    fireEvent.click(jevSwitch())
    setJevApiKey.mockRejectedValue(new Error('Secure storage is unavailable'))
    fireEvent.change(await screen.findByLabelText('Jev API Key'), { target: { value: 'ts-x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Key' }))

    expect(await screen.findByText('Secure storage is unavailable')).toBeInTheDocument()
    expect(saveAppSettings).not.toHaveBeenCalled()
  })

  it('cancelling the key form leaves the loop off and the form closed', async () => {
    await renderSetting()
    fireEvent.click(jevSwitch())
    await screen.findByLabelText('Jev API Key')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByLabelText('Jev API Key')).toBeNull()
    expect(jevSwitch().getAttribute('data-state')).toBe('unchecked')
    expect(saveAppSettings).not.toHaveBeenCalled()
  })
})
