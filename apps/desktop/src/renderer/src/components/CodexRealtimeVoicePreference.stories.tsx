import { useMemo, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { mockIpc } from '../../../../.storybook/mock-ipc'
import { CodexRealtimeVoicePreference } from './CodexRealtimeVoicePreference'

// The dedicated v3 catalog shipped by Codex 0.163.0; no live account is needed.
const VOICES = [
  'juniper', 'maple', 'spruce', 'ember', 'vale', 'breeze', 'arbor', 'sol', 'cove',
  'aube', 'bubbie', 'haetsal', 'hanul', 'himari', 'leher', 'miko', 'neer', 'porto',
  'rindo', 'rio', 'rivage', 'selva', 'sonna', 'tinta', 'viola',
]

function Preview({ state = 'ready', disabled = false, width = 640 }: {
  state?: 'ready' | 'loading' | 'error'; disabled?: boolean; width?: number
}) {
  const [value, setValue] = useState('cove')
  useMemo(() => {
    mockIpc('app', 'codexListRealtimeVoices', async () => {
      if (state === 'loading') return new Promise(() => {})
      if (state === 'error') throw new Error('Voice catalog unavailable')
      return { voices: VOICES, defaultVoice: 'cove' }
    })
  }, [state])
  return <div className="rounded-lg border bg-background text-foreground" style={{ width, maxWidth: '100%' }}>
    <CodexRealtimeVoicePreference projectPath={null} value={value} disabled={disabled}
      onChange={async (voice) => { setValue(voice) }} />
  </div>
}

const meta = {
  title: 'Settings/Codex realtime voice', component: CodexRealtimeVoicePreference,
  parameters: { layout: 'padded' }, args: { projectPath: null, value: 'cove', onChange: async () => {} },
} satisfies Meta<typeof CodexRealtimeVoicePreference>
export default meta
type Story = StoryObj<typeof meta>

export const V3Catalog: Story = {
  render: () => <Preview />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await canvas.findByRole('button', { name: 'Cove' }))
    const menu = await body.findByRole('dialog')
    await expect(within(menu).getAllByRole('button')).toHaveLength(25)
    await userEvent.click(within(menu).getByRole('button', { name: 'Miko' }))
    await expect(canvas.getByRole('button', { name: 'Miko' })).toBeEnabled()
    await expect(body.queryByRole('dialog')).not.toBeInTheDocument()
  },
}
export const Expanded: Story = {
  render: () => <Preview />,
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole('button', { name: 'Cove' }))
  },
}
export const Loading: Story = { render: () => <Preview state="loading" /> }
export const LoadError: Story = { render: () => <Preview state="error" /> }
export const Disabled: Story = { render: () => <Preview disabled /> }
export const NarrowDarkChinese: Story = {
  ...Expanded, render: () => <Preview width={320} />, globals: { theme: 'dark', locale: 'zh' },
}
