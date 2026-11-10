import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactElement } from 'react'
import type { DesktopVoiceSettings } from '@superone/shared/desktop-voice-route'
import { DOUBAO_DEFAULT_SPEAKER } from '@superone/shared/doubao-realtime'
import { GEMINI_DEFAULT_VOICE } from '@superone/shared/gemini-realtime'
import { mockIpc } from '../../../../../.storybook/mock-ipc'
import { DoubaoVoiceSetting } from './DoubaoVoiceSetting'

const blankKey = { configured: false, masked: '' }

let settings: DesktopVoiceSettings = {
  preference: 'doubao',
  speaker: DOUBAO_DEFAULT_SPEAKER,
  geminiVoice: GEMINI_DEFAULT_VOICE,
  key: blankKey,
  geminiKey: blankKey,
}
let keyStoreFails = false
let pending = false

mockIpc('app', 'getDoubaoVoiceSettings', () => pending ? new Promise(() => {}) : Promise.resolve(settings))
mockIpc('app', 'setDoubaoVoiceSettings', async (patch: unknown) => {
  if (keyStoreFails) throw new Error('Secure storage is unavailable on this machine')
  const next = patch && typeof patch === 'object' ? patch as Partial<DesktopVoiceSettings> & { apiKey?: string; geminiApiKey?: string } : {}
  const mask = (value: string | undefined, current: DesktopVoiceSettings['key']) => value === undefined
    ? current
    : value.trim()
      ? { configured: true, masked: `***${value.slice(-6)}` }
      : { configured: false, masked: '' }
  settings = {
    preference: next.preference ?? settings.preference,
    speaker: next.speaker ?? settings.speaker,
    geminiVoice: next.geminiVoice ?? settings.geminiVoice,
    key: mask(next.apiKey, settings.key),
    geminiKey: mask(next.geminiApiKey, settings.geminiKey),
  }
  return settings
})

function seed(next: DesktopVoiceSettings, opts: { keyStoreFails?: boolean; pending?: boolean } = {}) {
  return (Story: () => ReactElement) => {
    settings = next
    keyStoreFails = opts.keyStoreFails ?? false
    pending = opts.pending ?? false
    return <Story />
  }
}

const meta: Meta<typeof DoubaoVoiceSetting> = {
  title: 'Settings/DoubaoVoice',
  component: DoubaoVoiceSetting,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-3xl rounded-lg border border-border">
        <div className="border-b border-border px-4 py-2">
          <p className="text-xs font-medium text-muted-foreground">Voice</p>
        </div>
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof DoubaoVoiceSetting>

const empty: DesktopVoiceSettings = {
  preference: 'doubao',
  speaker: DOUBAO_DEFAULT_SPEAKER,
  geminiVoice: GEMINI_DEFAULT_VOICE,
  key: blankKey,
  geminiKey: blankKey,
}

/** Settings have not arrived, so every control stays disabled. */
export const Loading: Story = { decorators: [seed(empty, { pending: true })] }

/** Doubao selected and no speech key yet. The password field is the empty state. */
export const Empty: Story = { decorators: [seed(empty)] }

/** A saved Doubao key and the default speaker. The Gemini key stays hidden. */
export const Configured: Story = {
  decorators: [seed({
    preference: 'doubao',
    speaker: DOUBAO_DEFAULT_SPEAKER,
    geminiVoice: GEMINI_DEFAULT_VOICE,
    key: { configured: true, masked: '***k7q2m9' },
    geminiKey: blankKey,
  })],
}

/** Gemini 3.8 selected, with its voice and masked key. The Doubao key stays hidden. */
export const Gemini: Story = {
  decorators: [seed({
    preference: 'gemini',
    speaker: DOUBAO_DEFAULT_SPEAKER,
    geminiVoice: 'Zubenelgenubi',
    key: blankKey,
    geminiKey: { configured: true, masked: '***live9' },
  })],
}

/** Secure storage refuses the key. The error stays under the form and the previous status remains. */
export const KeyStoreError: Story = { decorators: [seed(empty, { keyStoreFails: true })] }

/** Doubao selected with a long masked key, so the row has to wrap. */
export const LongKey: Story = {
  decorators: [seed({
    preference: 'doubao',
    speaker: 'en_female_stokie_uranus_bigtts',
    geminiVoice: GEMINI_DEFAULT_VOICE,
    key: { configured: true, masked: `***${'k7q2m9'.repeat(12)}` },
    geminiKey: { configured: true, masked: `***${'live9k'.repeat(12)}` },
  })],
}

/** Narrow settings pane. The model switch stays inside the card. */
export const Narrow: Story = {
  decorators: [
    seed(empty),
    (Story) => <div className="max-w-[280px]"><Story /></div>,
  ],
}
