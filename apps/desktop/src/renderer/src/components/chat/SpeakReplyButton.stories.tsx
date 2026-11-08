import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect } from 'react'
import { Toaster } from 'sonner'
import { expect, userEvent, within } from 'storybook/test'
import { mockIpc } from '../../../../../.storybook/mock-ipc'
import { SpeakReplyButton } from './SpeakReplyButton'
import { resetSpeechPlaybackForTests } from './speech-playback'

class FakeAudio {
  onended: (() => void) | null = null
  src = ''
  play() { return Promise.resolve() }
  pause() {}
}

function Stage({ text = 'The build finished and the tests passed.' }: { text?: string }) {
  useEffect(() => () => { resetSpeechPlaybackForTests() }, [])
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <SpeakReplyButton messageId="story-reply" text={text} />
      <Toaster />
    </div>
  )
}

const meta = {
  title: 'Chat/SpeakReplyButton',
  component: Stage,
  parameters: { layout: 'padded' },
  beforeEach: () => {
    window.Audio = FakeAudio as unknown as typeof Audio
    URL.createObjectURL = () => 'blob:speech'
    URL.revokeObjectURL = () => {}
    mockIpc('app', 'hasSavedSpeech', async () => false)
    resetSpeechPlaybackForTests()
  },
} satisfies Meta<typeof Stage>

export default meta
type Story = StoryObj<typeof meta>

export const Idle: Story = {}

export const Playing: Story = {
  beforeEach: () => {
    mockIpc('app', 'speakText', async () => ({ ok: true, mediaType: 'audio/mpeg', audioBase64: btoa('mp3') }))
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Read aloud' }))
    await expect(canvas.getByRole('button', { name: 'Pause' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Stop reading' })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Pause' }))
    await expect(canvas.getByRole('button', { name: 'Resume' })).toBeVisible()
  },
}

export const Saved: Story = {
  beforeEach: () => {
    mockIpc('app', 'hasSavedSpeech', async () => true)
    mockIpc('app', 'readSavedSpeech', async () => ({
      ok: true,
      clips: [{ mediaType: 'audio/mpeg', audioBase64: btoa('mp3') }],
    }))
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Play Saved' }))
    await expect(canvas.getByRole('button', { name: 'Pause' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Stop reading' })).toBeVisible()
  },
}

export const Failed: Story = {
  beforeEach: () => {
    mockIpc('app', 'speakText', async () => ({ ok: false, error: 'No speech provider is configured' }))
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Read aloud' }))
    await expect(await within(document.body).findByText('No speech provider is configured')).toBeVisible()
  },
}

export const Truncated: Story = {
  args: { text: 'A very long reply.' },
  beforeEach: () => {
    mockIpc('app', 'speakText', async () => ({ ok: true, mediaType: 'audio/mpeg', audioBase64: btoa('mp3'), truncated: true }))
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Read aloud' }))
    await expect(await within(document.body).findByText('Reading the first part of this reply')).toBeVisible()
  },
}

export const Loading: Story = {
  beforeEach: () => {
    mockIpc('app', 'speakText', () => new Promise(() => {}))
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Read aloud' }))
    await expect(canvas.getByRole('button', { name: 'Stop reading' })).toBeVisible()
  },
}
