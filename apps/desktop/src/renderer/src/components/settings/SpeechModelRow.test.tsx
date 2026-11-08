/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BUILTIN_PLATFORMS, type Credential } from '@superone/shared/platform-registry'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from '@/stores/settings'
import { SpeechModelRow } from './SpeechModelRow'

const platforms = BUILTIN_PLATFORMS.filter((platform) => platform.id === 'openai' || platform.id === 'elevenlabs')

function credential(partial: Pick<Credential, 'id' | 'platformId' | 'name' | 'overrides'>): Credential {
  return { planId: 'api', secret: '', notes: '', sortOrder: 0, ...partial }
}

const credentials: Credential[] = [
  credential({
    id: 'oa',
    platformId: 'openai',
    name: 'Work',
    overrides: {
      audio: { models: [{ id: 'gpt-4o-mini-tts', name: 'GPT-4o mini TTS', tasks: ['tts'] }] },
    },
  }),
  credential({
    id: 'el',
    platformId: 'elevenlabs',
    name: 'Personal',
    overrides: {
      elevenlabs: { models: [
        { id: 'eleven_v3', name: 'Eleven v3', tasks: ['tts'] },
        { id: 'eleven_v4', name: 'Eleven v4', tasks: ['tts'] },
      ] },
    },
  }),
]

const setBinding = vi.fn()
const clearBinding = vi.fn()

beforeEach(() => {
  setBinding.mockReset().mockImplementation(async (binding) => {
    useSettingsStore.setState({ bindings: [binding] })
  })
  clearBinding.mockReset().mockImplementation(async () => {
    useSettingsStore.setState({ bindings: [] })
  })
  useSettingsStore.setState({
    platforms,
    credentials,
    bindings: [],
    fetchProviderData: async () => {},
    setBinding,
    clearBinding,
  })
})

afterEach(() => {
  cleanup()
  useSettingsStore.setState({ platforms: [], credentials: [], bindings: [] })
})

describe('SpeechModelRow', () => {
  it('saves a model grouped under its provider and can return to auto', async () => {
    const user = userEvent.setup()
    render(<SpeechModelRow />)
    await user.click(await screen.findByRole('button', { name: 'Auto (First Usable)' }))
    expect(await screen.findByRole('menuitem', { name: 'GPT-4o mini TTS' })).toBeTruthy()
    expect(screen.queryByText('Work')).toBeNull()
    expect(screen.queryByText('Personal')).toBeNull()
    await user.click(await screen.findByRole('menuitem', { name: 'Eleven v4' }))
    await waitFor(() => expect(setBinding).toHaveBeenCalledWith({
      consumer: 'tts',
      credentialId: 'el',
      config: { modelId: 'eleven_v4' },
    }))
    expect(screen.getByRole('button', { name: 'Eleven v4' }).textContent).not.toContain('Personal')

    await user.click(screen.getByRole('button', { name: /Eleven v4/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'Auto (First Usable)' }))
    await waitFor(() => expect(clearBinding).toHaveBeenCalledWith('tts'))
  })

  it('shows the key name only when a provider has more than one key', async () => {
    const user = userEvent.setup()
    useSettingsStore.setState({
      credentials: [
        ...credentials,
        credential({
          id: 'el-2',
          platformId: 'elevenlabs',
          name: 'Studio',
          overrides: {
            elevenlabs: { models: [{ id: 'eleven_v3', name: 'Eleven v3', tasks: ['tts'] }] },
          },
        }),
      ],
    })
    render(<SpeechModelRow />)
    await user.click(await screen.findByRole('button', { name: 'Auto (First Usable)' }))
    expect(await screen.findByText('Personal')).toBeTruthy()
    expect(screen.getByText('Studio')).toBeTruthy()
    expect(screen.queryByText('Work')).toBeNull()
  })
})
