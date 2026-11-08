import { useMemo } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { BUILTIN_PLATFORMS, type ConsumerBinding, type Credential } from '@superone/shared/platform-registry'
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
      audio: { models: [
        { id: 'gpt-4o-mini-tts', name: 'GPT-4o mini TTS', tasks: ['tts'] },
        { id: 'tts-1', name: 'TTS-1', tasks: ['tts'] },
      ] },
    },
  }),
  credential({
    id: 'el',
    platformId: 'elevenlabs',
    name: 'Personal',
    overrides: {
      elevenlabs: { models: [
        { id: 'eleven_v3', name: 'Eleven v3', tasks: ['tts'] },
        { id: 'eleven_v4', name: 'Eleven v4 with a long display name', tasks: ['tts'] },
      ] },
    },
  }),
]

function Stage({
  creds = credentials,
  binding,
  width = 640,
}: {
  creds?: Credential[]
  binding?: ConsumerBinding
  width?: number
}) {
  const credKey = creds.map((item) => item.id).join(',')
  const bindingKey = binding ? `${binding.credentialId}:${binding.config?.modelId ?? ''}` : ''
  useMemo(() => {
    useSettingsStore.setState({
      platforms,
      credentials: creds,
      bindings: binding ? [binding] : [],
      fetchProviderData: async () => {},
      setBinding: async (next) => { useSettingsStore.setState({ bindings: [next] }) },
      clearBinding: async () => { useSettingsStore.setState({ bindings: [] }) },
    })
    // Props are identified by bindingKey and credKey. The store write must not
    // run again after a menu choice updates the same binding.
  }, [bindingKey, credKey])
  return (
    <div className="rounded-lg border bg-background text-foreground" style={{ width, maxWidth: '100%' }}>
      <SpeechModelRow />
    </div>
  )
}

const meta = {
  title: 'Settings/Speech model',
  component: SpeechModelRow,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof SpeechModelRow>
export default meta
type Story = StoryObj<typeof meta>

export const Grouped: Story = {
  render: () => <Stage />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Auto (First Usable)' }))
    const body = within(canvasElement.ownerDocument.body)
    await expect(await body.findByRole('menuitem', { name: 'GPT-4o mini TTS' })).toBeVisible()
    await expect(body.queryByText('Work')).toBeNull()
    await expect(body.queryByText('Personal')).toBeNull()
    await userEvent.click(await body.findByRole('menuitem', { name: 'Eleven v4 with a long display name' }))
    await expect(canvas.getByRole('button', { name: /Eleven v4/ })).toBeVisible()
  },
}

export const Selected: Story = {
  render: () => <Stage binding={{ consumer: 'tts', credentialId: 'oa', config: { modelId: 'tts-1' } }} />,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole('button', { name: /TTS-1/ })).toBeVisible()
  },
}

export const Empty: Story = {
  render: () => <Stage creds={[]} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Auto (First Usable)' }))
    const body = within(canvasElement.ownerDocument.body)
    await expect(await body.findByRole('menuitem', { name: 'Auto (First Usable)' })).toBeVisible()
    await expect(body.queryByRole('menuitem', { name: 'Eleven v3' })).toBeNull()
  },
}

export const Narrow: Story = {
  render: () => <Stage binding={{ consumer: 'tts', credentialId: 'el', config: { modelId: 'eleven_v4' } }} width={320} />,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole('button', { name: /Eleven v4/ })).toBeVisible()
  },
}
