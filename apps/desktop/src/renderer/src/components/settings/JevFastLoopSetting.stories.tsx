import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactElement } from 'react'
import { mockIpc } from '../../../../../.storybook/mock-ipc'
import { JevFastLoopSetting } from './JevFastLoopSetting'

type KeyStatus = { configured: boolean; masked: string }

let settings = { jevFastLoopEnabled: false }
let jevKey: KeyStatus = { configured: false, masked: '' }
let keyStoreFails = false

mockIpc('app', 'getAppSettings', async () => settings)
mockIpc('app', 'saveAppSettings', async (patch: unknown) => {
  settings = { ...settings, ...(patch as Partial<typeof settings>) }
  return settings
})
mockIpc('app', 'getJevApiKeyStatus', async () => jevKey)
mockIpc('app', 'setJevApiKey', async (key: unknown) => {
  if (keyStoreFails) throw new Error('Secure storage is unavailable on this machine')
  jevKey = { configured: true, masked: `***${String(key).slice(-6)}` }
  return jevKey
})

/** The rows read their state on mount, so a story seeds the mocks during render — before that effect runs. */
function seed(enabled: boolean, key: KeyStatus = { configured: false, masked: '' }, opts: { keyStoreFails?: boolean } = {}) {
  return (Story: () => ReactElement) => {
    settings = { jevFastLoopEnabled: enabled }
    jevKey = key
    keyStoreFails = opts.keyStoreFails ?? false
    return <Story />
  }
}

const meta: Meta<typeof JevFastLoopSetting> = {
  title: 'Settings/JevFastLoop',
  component: JevFastLoopSetting,
  parameters: { layout: 'padded' },
  decorators: [
    // The component renders card rows; wrap it in the same bordered card General uses.
    (Story) => (
      <div className="mx-auto max-w-3xl rounded-lg border border-border">
        <div className="border-b border-border px-4 py-2">
          <p className="text-xs font-medium text-muted-foreground">Experimental</p>
        </div>
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof JevFastLoopSetting>

/** Off and no key yet — flipping the switch opens the key form instead of enabling. */
export const NeedsKey: Story = { decorators: [seed(false)] }

/** On with a stored key — the masked key and its replace control show under the row. */
export const Enabled: Story = {
  decorators: [seed(true, { configured: true, masked: '***k7q2m9' })],
}

/** Key stored but loop switched off — a plain toggle, no form. */
export const DisabledWithKey: Story = {
  decorators: [seed(false, { configured: true, masked: '***k7q2m9' })],
}

/** Secure storage refuses the key — the error shows under the form and the loop stays off. */
export const KeyStoreError: Story = {
  decorators: [seed(false, { configured: false, masked: '' }, { keyStoreFails: true })],
}
