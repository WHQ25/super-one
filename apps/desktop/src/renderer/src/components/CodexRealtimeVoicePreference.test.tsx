/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodexVoicePreviews } from '@superone/shared/codex-voice-previews'
import { CodexRealtimeVoicePreference } from './CodexRealtimeVoicePreference'

class MockAudio {
  src: string
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  play = vi.fn(() => playResult?.() ?? Promise.resolve())
  pause = vi.fn()
  load = vi.fn()
  removeAttribute = vi.fn()
  constructor(src: string) { this.src = src; players.push(this) }
}
let players: MockAudio[] = []
let playResult: (() => Promise<void>) | null = null
const listVoices = vi.fn(async () => ({ voices: ['juniper', 'cove', 'spruce', 'porto'], defaultVoice: 'cove' }))
const PREVIEWS: CodexVoicePreviews = {
  cove: { previewUrl: 'https://persistent.oaistatic.com/cove.m4a', accent: 'American English' },
  juniper: { previewUrl: 'https://persistent.oaistatic.com/juniper.m4a', accent: 'American English' },
  spruce: { accent: 'British English' },
  arrullo: { accent: 'Mexican Spanish' },
}
const listPreviews = vi.fn(async () => PREVIEWS)

beforeEach(() => {
  players = []
  playResult = null
  vi.clearAllMocks()
  listPreviews.mockReset().mockResolvedValue(PREVIEWS)
  vi.stubGlobal('Audio', MockAudio)
  Object.defineProperty(window, 'app', { configurable: true, value: {
    codexListRealtimeVoices: listVoices,
    codexListRealtimeVoicePreviews: listPreviews,
  } })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

async function open(onChange = vi.fn(async (_voice: string) => {})) {
  const result = render(<CodexRealtimeVoicePreference projectPath="/repo" value="" onChange={onChange} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Cove' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Preview Cove' }).hasAttribute('disabled')).toBe(false))
  return { ...result, onChange }
}

describe('CodexRealtimeVoicePreference', () => {
  it('prepares grouping metadata before opening and reuses it without regrouping on reopen', async () => {
    let resolve!: (data: CodexVoicePreviews) => void
    listPreviews.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    render(<CodexRealtimeVoicePreference projectPath="/repo" value="" onChange={vi.fn()} />)
    await waitFor(() => expect(listPreviews).toHaveBeenCalledWith('en'))
    const trigger = screen.getByRole('button')
    expect(trigger.hasAttribute('disabled')).toBe(true)
    fireEvent.click(trigger)
    expect(screen.queryByRole('dialog')).toBeNull()

    await act(async () => resolve(PREVIEWS))
    fireEvent.click(await screen.findByRole('button', { name: 'Cove' }))
    expect(screen.getByRole('group', { name: 'American English' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Other' })).toBeTruthy()
    expect(screen.queryByText(/Grouped by primary language/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Preview Spruce' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Spruce' }).hasAttribute('disabled')).toBe(false)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Cove' }))
    expect(screen.getByRole('group', { name: 'American English' })).toBeTruthy()
    expect(listPreviews).toHaveBeenCalledTimes(1)
  })

  it('groups selectable voices by upstream language/accent with an Other fallback', async () => {
    await open()
    const american = screen.getByRole('group', { name: 'American English' })
    expect(within(american).getByRole('button', { name: 'Juniper' })).toBeTruthy()
    expect(within(american).getByRole('button', { name: 'Cove' })).toBeTruthy()
    expect(within(screen.getByRole('group', { name: 'British English' })).getByRole('button', { name: 'Spruce' })).toBeTruthy()
    expect(within(screen.getByRole('group', { name: 'Other' })).getByRole('button', { name: 'Porto' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Arrullo' })).toBeNull()
  })

  it('plays and stops without saving or closing the picker', async () => {
    const { onChange } = await open()
    fireEvent.click(screen.getByRole('button', { name: 'Preview Cove' }))
    await waitFor(() => expect(players[0].play).toHaveBeenCalled())
    expect(players[0].src).toBe('https://persistent.oaistatic.com/cove.m4a')
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Stop Cove Preview' }))
    expect(players[0].pause).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Preview Cove' })).toBeTruthy()
  })

  it('switches samples and ignores a stale play rejection', async () => {
    await open()
    let reject!: (error: Error) => void
    playResult = () => new Promise((_resolve, fail) => { reject = fail })
    fireEvent.click(screen.getByRole('button', { name: 'Preview Cove' }))
    playResult = null
    fireEvent.click(screen.getByRole('button', { name: 'Preview Juniper' }))
    await waitFor(() => expect(players[1].play).toHaveBeenCalled())
    expect(players[0].pause).toHaveBeenCalled()
    await act(async () => reject(new Error('old sample failed')))
    expect(screen.getByRole('button', { name: 'Stop Juniper Preview' })).toBeTruthy()
  })

  it('stops playback when selecting a voice and persists that selection', async () => {
    const { onChange } = await open()
    fireEvent.click(screen.getByRole('button', { name: 'Preview Cove' }))
    fireEvent.click(screen.getByRole('button', { name: 'Juniper' }))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('juniper'))
    expect(players[0].pause).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('cleans up on close and unmount', async () => {
    const result = await open()
    fireEvent.click(screen.getByRole('button', { name: 'Preview Cove' }))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(players[0].pause).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cove' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Preview Cove' }).hasAttribute('disabled')).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Preview Cove' }))
    result.unmount()
    expect(players[1].pause).toHaveBeenCalled()
  })

  it('clears the playing state on natural completion and shows playback failures', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Preview Cove' }))
    act(() => players[0].onended?.())
    expect(screen.getByRole('button', { name: 'Preview Cove' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Preview Cove' }))
    act(() => players[1].onerror?.())
    expect(screen.getByRole('alert').textContent).toContain('Preview could not play')
    expect(screen.getByRole('button', { name: 'Preview Cove' })).toBeTruthy()
  })

  it('offers retry after sample loading fails while selection stays usable', async () => {
    listPreviews.mockRejectedValueOnce(new Error('unavailable'))
    render(<CodexRealtimeVoicePreference projectPath="/repo" value="" onChange={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Cove' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: 'Juniper' }).hasAttribute('disabled')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Preview Cove' }).hasAttribute('disabled')).toBe(false))
  })

  it('stops and disables playback when the control becomes disabled', async () => {
    const result = await open()
    fireEvent.click(screen.getByRole('button', { name: 'Preview Cove' }))
    result.rerender(<CodexRealtimeVoicePreference projectPath="/repo" value="" disabled onChange={vi.fn()} />)
    expect(players[0].pause).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Preview Cove' }).hasAttribute('disabled')).toBe(true)
  })

  it('ignores a catalog response from a previous project context', async () => {
    let resolve!: (urls: CodexVoicePreviews) => void
    listPreviews.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    const onChange = vi.fn(async () => {})
    const result = render(<CodexRealtimeVoicePreference projectPath="/old" value="" onChange={onChange} />)
    await waitFor(() => expect(listPreviews).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true)
    result.rerender(<CodexRealtimeVoicePreference projectPath="/new" value="" onChange={onChange} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Cove' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Preview Cove' }).hasAttribute('disabled')).toBe(false))
    await act(async () => resolve({ cove: { previewUrl: 'https://persistent.oaistatic.com/stale.m4a' } }))
    fireEvent.click(screen.getByRole('button', { name: 'Preview Cove' }))
    expect(players[0].src).toBe('https://persistent.oaistatic.com/cove.m4a')
  })

  it('releases a stalled sample and allows replay after the playback deadline', async () => {
    await open()
    playResult = () => new Promise(() => {})
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'Preview Cove' }))
    act(() => vi.advanceTimersByTime(15_000))
    expect(players[0].pause).toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('Preview could not play')
    expect(screen.getByRole('button', { name: 'Preview Cove' }).hasAttribute('disabled')).toBe(false)
  })
})
