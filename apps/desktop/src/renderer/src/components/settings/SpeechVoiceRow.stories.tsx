import { useMemo } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import type { SpeechVoiceCatalogResult } from '@superone/shared/agent-types'
import { mockIpc } from '../../../../../.storybook/mock-ipc'
import { SpeechVoiceRow } from './SpeechVoiceRow'

const OPENAI: SpeechVoiceCatalogResult = {
  credentialId: 'cred-openai',
  defaultVoice: 'alloy',
  selectedVoice: 'alloy',
  voices: ['alloy', 'ash', 'ballad', 'cedar', 'coral', 'echo', 'fable', 'marin', 'nova', 'onyx', 'sage', 'shimmer', 'verse']
    .map((id) => ({ id, label: id[0]!.toUpperCase() + id.slice(1) })),
}

const LONG: SpeechVoiceCatalogResult = {
  credentialId: 'cred-long',
  defaultVoice: 'voice-0',
  selectedVoice: 'voice-0',
  voices: Array.from({ length: 30 }, (_, index) => ({
    id: `voice-${index}`,
    label: `Voice ${index} with a long display name`,
  })),
}

function Stage({
  result,
  width = 640,
}: {
  result: SpeechVoiceCatalogResult | 'loading'
  width?: number
}) {
  useMemo(() => {
    mockIpc('app', 'listSpeechVoices', async () => {
      if (result === 'loading') return new Promise(() => {})
      return result
    })
    mockIpc('app', 'saveAppSettings', async (patch: unknown) => patch)
  }, [result])
  return (
    <div className="rounded-lg border bg-background text-foreground" style={{ width, maxWidth: '100%' }}>
      <SpeechVoiceRow />
    </div>
  )
}

const meta = {
  title: 'Settings/Speech voice',
  component: SpeechVoiceRow,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof SpeechVoiceRow>
export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = {
  render: () => <Stage result={OPENAI} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Alloy' }))
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole('menuitem', { name: 'Marin' }))
    await expect(canvas.getByRole('button', { name: 'Marin' })).toBeVisible()
  },
}

export const Loading: Story = {
  render: () => <Stage result="loading" />,
  play: async ({ canvasElement }) => {
    const button = await within(canvasElement).findByRole('button', { name: 'Loading…' })
    await expect(button).toBeDisabled()
  },
}

export const Unavailable: Story = {
  render: () => <Stage result={{ error: 'unconfigured' }} />,
  play: async ({ canvasElement }) => {
    const button = await within(canvasElement).findByRole('button', { name: 'Add a speech provider first' })
    await expect(button).toBeDisabled()
  },
}

export const Failed: Story = {
  render: () => <Stage result={{ error: 'failed' }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('button', { name: 'Could not load voices' })).toBeDisabled()
    await expect(canvas.getByRole('button', { name: 'Retry' })).toBeEnabled()
  },
}

export const AccountVoicesUnavailable: Story = {
  render: () => <Stage result={{
    credentialId: 'cred-el',
    defaultVoice: '21m00Tcm4TlvDq8ikWAM',
    selectedVoice: '21m00Tcm4TlvDq8ikWAM',
    fallback: true,
    voices: [{ id: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel' }],
  }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('button', { name: 'Rachel' })).toBeEnabled()
    await expect(canvas.getByText('Account voices could not be loaded. Showing the built-in voice.')).toBeVisible()
  },
}

export const LongList: Story = {
  render: () => <Stage result={LONG} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Voice 0 with a long display name' }))
    const body = within(canvasElement.ownerDocument.body)
    await expect(await body.findByRole('menuitem', { name: 'Voice 29 with a long display name' })).toBeVisible()
  },
}

const ELEVENLABS: SpeechVoiceCatalogResult = {
  credentialId: 'cred-el',
  defaultVoice: '21m00Tcm4TlvDq8ikWAM',
  selectedVoice: '21m00Tcm4TlvDq8ikWAM',
  customVoice: true,
  voices: [
    { id: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel' },
    { id: 'custom', label: 'Mine' },
  ],
}

export const VoiceId: Story = {
  render: () => <Stage result={ELEVENLABS} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = await canvas.findByRole('textbox', { name: 'Voice ID' })
    await expect(canvas.getByRole('button', { name: 'Preview' })).toBeEnabled()
    await expect(canvas.getByRole('button', { name: 'Use' })).toBeDisabled()
    await userEvent.type(input, 'abcVoiceId')
    await userEvent.click(canvas.getByRole('button', { name: 'Use' }))
    await expect(canvas.getByRole('button', { name: 'abcVoiceId' })).toBeVisible()
  },
}

export const VoiceIdNarrow: Story = {
  render: () => <Stage result={ELEVENLABS} width={320} />,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole('textbox', { name: 'Voice ID' })).toBeVisible()
  },
}

export const Narrow: Story = {
  render: () => <Stage result={{
    credentialId: 'cred-el',
    defaultVoice: 'voice',
    selectedVoice: 'voice',
    voices: [{ id: 'voice', label: 'A very long ElevenLabs voice name that should truncate' }],
  }} width={320} />,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole('button', { name: 'A very long ElevenLabs voice name that should truncate' })).toBeVisible()
  },
}
