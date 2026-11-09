import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactElement } from 'react'
import type { DoubaoVoiceSettings } from '@superone/shared/doubao-call'
import { DOUBAO_DEFAULT_SPEAKER } from '@superone/shared/doubao-realtime'
import { mockIpc } from '../../../../../.storybook/mock-ipc'
import { DoubaoVoiceSetting } from './DoubaoVoiceSetting'

let settings: DoubaoVoiceSettings = {
  preference: 'auto',
  speaker: DOUBAO_DEFAULT_SPEAKER,
  key: { configured: false, masked: '' },
}
let keyStoreFails = false
let pending = false

mockIpc('app', 'getDoubaoVoiceSettings', () => pending ? new Promise(() => {}) : Promise.resolve(settings))
mockIpc('app', 'setDoubaoVoiceSettings', async (patch: unknown) => {
  if (keyStoreFails) throw new Error('Secure storage is unavailable on this machine')
  const next = patch && typeof patch === 'object' ? patch as Partial<DoubaoVoiceSettings> & { apiKey?: string } : {}
  settings = {
    preference: next.preference ?? settings.preference,
    speaker: next.speaker ?? settings.speaker,
    key: next.apiKey === undefined
      ? settings.key
      : next.apiKey.trim()
        ? { configured: true, masked: `***${next.apiKey.slice(-6)}` }
        : { configured: false, masked: '' },
  }
  return settings
})

function seed(next: DoubaoVoiceSettings, opts: { keyStoreFails?: boolean; pending?: boolean } = {}) {
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

const empty: DoubaoVoiceSettings = {
  preference: 'auto',
  speaker: DOUBAO_DEFAULT_SPEAKER,
  key: { configured: false, masked: '' },
}

/** Settings have not arrived, so every control stays disabled. */
export const Loading: Story = { decorators: [seed(empty, { pending: true })] }

/** No speech key yet. The password field is the empty state. */
export const Empty: Story = { decorators: [seed(empty)] }

/** A saved key, Auto frontend, and the default speaker. */
export const Configured: Story = {
  decorators: [seed({
    preference: 'auto',
    speaker: DOUBAO_DEFAULT_SPEAKER,
    key: { configured: true, masked: '***k7q2m9' },
  })],
}

/** Secure storage refuses the key. The error stays under the form and the previous status remains. */
export const KeyStoreError: Story = { decorators: [seed(empty, { keyStoreFails: true })] }

/** Forced Doubao with a long masked key, so the row has to wrap. */
export const LongKey: Story = {
  decorators: [seed({
    preference: 'doubao',
    speaker: 'en_female_stokie_uranus_bigtts',
    key: { configured: true, masked: `***${'k7q2m9'.repeat(12)}` },
  })],
}

/** Narrow settings pane. The frontend switch scrolls instead of overflowing the card. */
export const Narrow: Story = {
  decorators: [
    seed(empty),
    (Story) => <div className="max-w-[280px]"><Story /></div>,
  ],
}
