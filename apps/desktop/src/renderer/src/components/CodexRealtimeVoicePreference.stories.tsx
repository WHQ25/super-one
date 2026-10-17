import { useMemo, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { mockIpc } from '../../../../.storybook/mock-ipc'
import { CodexRealtimeVoicePreference } from './CodexRealtimeVoicePreference'

const VOICES = [
  'juniper', 'maple', 'spruce', 'ember', 'vale', 'breeze', 'arbor', 'sol', 'cove',
  'aube', 'bubbie', 'haetsal', 'hanul', 'himari', 'leher', 'miko', 'neer', 'porto',
  'rindo', 'rio', 'rivage', 'selva', 'sonna', 'tinta', 'viola',
]

const VOICE_GROUPS: Record<string, string[]> = {
  'American English': ['juniper', 'maple', 'spruce', 'ember', 'breeze', 'sol', 'cove', 'bubbie'],
  'British English': ['arbor', 'vale'],
  'Brazilian Portuguese': ['viola', 'rio'],
  French: ['aube', 'rivage'], German: ['miko', 'sonna'], Hindi: ['leher', 'neer'],
  Japanese: ['rindo', 'himari'], Korean: ['haetsal', 'hanul'], 'Mexican Spanish': ['tinta'],
}
const ACCENTS = Object.fromEntries(Object.entries(VOICE_GROUPS).flatMap(([accent, voices]) => voices.map((voice) => [voice, accent])))

// Six seconds of offline silence exercises the real audio lifecycle without live services.
function silentSample(): string {
  const bytes = new Uint8Array(44 + 8_000 * 2 * 6)
  const view = new DataView(bytes.buffer)
  const text = (offset: number, value: string) => Array.from(value).forEach((char, index) => { bytes[offset + index] = char.charCodeAt(0) })
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVEfmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, 8_000, true); view.setUint32(28, 16_000, true)
  view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  text(36, 'data'); view.setUint32(40, bytes.length - 44, true)
  return `data:audio/wav;base64,${btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))}`
}
const SAMPLE = silentSample()
type State = 'ready' | 'loading' | 'error' | 'previews-loading' | 'previews-delayed' | 'previews-error' | 'previews-empty' | 'playback-error'

function Preview({ state = 'ready', disabled = false, width = 640 }: {
  state?: State; disabled?: boolean; width?: number
}) {
  const [value, setValue] = useState('cove')
  useMemo(() => {
    let attempts = 0
    mockIpc('app', 'codexListRealtimeVoices', async () => {
      if (state === 'loading') return new Promise(() => {})
      if (state === 'error') throw new Error('Voice catalog unavailable')
      return { voices: VOICES, defaultVoice: 'cove' }
    })
    mockIpc('app', 'codexListRealtimeVoicePreviews', async () => {
      if (state === 'previews-loading') return new Promise(() => {})
      if (state === 'previews-delayed') await new Promise((resolve) => setTimeout(resolve, 1500))
      if (state === 'previews-error' && attempts++ === 0) throw new Error('Previews unavailable')
      if (state === 'previews-empty') return {}
      return Object.fromEntries(VOICES.map((voice) => [voice, {
        accent: ACCENTS[voice],
        previewUrl: voice === 'porto' ? undefined : state === 'playback-error' ? 'data:audio/wav;base64,AAAA' : SAMPLE,
      }]))
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

const expand: NonNullable<Story['play']> = async ({ canvasElement }) => {
  await userEvent.click(await within(canvasElement).findByRole('button', { name: 'Cove' }))
}

export const V3Catalog: Story = {
  render: () => <Preview />,
  play: async (context) => {
    await expand(context)
    const canvas = within(context.canvasElement)
    const body = within(context.canvasElement.ownerDocument.body)
    const menu = await body.findByRole('dialog')
    await expect(within(menu).getByRole('button', { name: 'Preview Porto' })).toBeDisabled()
    await userEvent.click(within(menu).getByRole('button', { name: 'Miko' }))
    await expect(canvas.getByRole('button', { name: 'Miko' })).toBeEnabled()
    await expect(body.queryByRole('dialog')).not.toBeInTheDocument()
  },
}
export const Expanded: Story = { render: () => <Preview />, play: expand }
export const Loading: Story = { render: () => <Preview state="loading" /> }
export const LoadError: Story = { render: () => <Preview state="error" /> }
export const Disabled: Story = { render: () => <Preview disabled /> }
export const PreviewsLoading: Story = { render: () => <Preview state="previews-loading" /> }
export const PreviewsDelayed: Story = { render: () => <Preview state="previews-delayed" /> }
export const NoPreviews: Story = { render: () => <Preview state="previews-empty" />, play: expand }
export const PreviewsRetry: Story = {
  render: () => <Preview state="previews-error" />,
  play: async (context) => {
    await expand(context)
    const body = within(context.canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole('button', { name: 'Retry' }))
    await expect(body.getByRole('button', { name: 'Preview Cove' })).toBeEnabled()
  },
}
export const Playback: Story = {
  render: () => <Preview />,
  play: async (context) => {
    await expand(context)
    const body = within(context.canvasElement.ownerDocument.body)
    const button = await body.findByRole('button', { name: 'Preview Cove' })
    await expect(button).toBeEnabled()
    await userEvent.click(button)
    await expect(body.getByRole('button', { name: 'Stop Cove Preview' })).toHaveAttribute('aria-pressed', 'true')
  },
}
export const PlaybackError: Story = {
  render: () => <Preview state="playback-error" />,
  play: async (context) => {
    await expand(context)
    const body = within(context.canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole('button', { name: 'Preview Cove' }))
    await expect(await body.findByRole('alert')).toHaveTextContent('Preview could not play')
  },
}
export const PreviewLoadError: Story = { render: () => <Preview state="previews-error" />, play: expand }
export const NarrowDarkChinese: Story = {
  render: () => <Preview width={320} />, globals: { theme: 'dark', locale: 'zh' }, play: expand,
}
