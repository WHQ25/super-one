import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import type { SessionAgentLaunchSettings, SessionAgentProfile } from '@superone/shared/agent-types'
import { ClaudeLaunchModel } from './launch-model'

const profile: SessionAgentProfile = {
  id: 'claude-base', name: 'Claude', harnessId: 'claude', defaultConfig: {}, efforts: ['low', 'high'],
  models: [{ id: 'opus', name: 'Opus', supportsFastMode: true }, { id: 'sonnet', name: 'Sonnet' }],
  apiProviders: [{ id: 'official', name: 'Anthropic API' }, { id: 'gateway', name: 'Compatible API', modelEnv: { opus: { id: 'gateway-opus' } } }, { id: 'claude-account:cli', name: 'Subscription' }],
}

function Preview({ provider = 'official', model = 'opus' }: { provider?: string; model?: string }) {
  const [settings, setSettings] = useState<SessionAgentLaunchSettings>({ apiProviderId: provider, model })
  return <div className="flex w-80 flex-col items-start gap-3 p-4">
    <ClaudeLaunchModel profile={profile} catalog="profile" offerFastMode {...settings} model={settings.model} effort={settings.effort} apiProviderId={settings.apiProviderId}
      onChange={patch => setSettings(current => ({ ...current, ...patch }))} />
    <span data-testid="choice">{settings.claudeFastMode ? 'Fast on' : 'Fast off'}</span>
  </div>
}

export default { title: 'Chat/Models/Claude Fast Mode', component: ClaudeLaunchModel, render: Preview } satisfies Meta
type Story = StoryObj<typeof Preview>
export const OfficialApi: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement), page = within(canvasElement.ownerDocument.body)
    await userEvent.click(canvas.getByRole('button', { name: /Opus/ }))
    const toggle = await page.findByRole('switch', { name: 'Fast mode' })
    await expect(toggle).not.toBeChecked()
    await userEvent.click(toggle)
    await expect(toggle).toBeChecked()
    await expect(canvas.getByTestId('choice')).toHaveTextContent('Fast on')
  },
}
export const Dark: Story = { ...OfficialApi, globals: { theme: 'dark' } }
export const UnsupportedModel: Story = { args: { model: 'sonnet' }, play: async ({ canvasElement }) => {
  await userEvent.click(within(canvasElement).getByRole('button', { name: /Sonnet/ }))
  await expect(within(canvasElement.ownerDocument.body).queryByRole('switch', { name: 'Fast mode' })).toBeNull()
} }
export const CompatibleApi: Story = { ...UnsupportedModel, args: { provider: 'gateway' }, play: async ({ canvasElement }) => {
  await userEvent.click(within(canvasElement).getByRole('button', { name: /gateway-opus/ }))
  await expect(within(canvasElement.ownerDocument.body).queryByRole('switch', { name: 'Fast mode' })).toBeNull()
} }
export const Subscription: Story = { ...OfficialApi, args: { provider: 'claude-account:cli' } }
export const SubscriptionDark: Story = { ...Subscription, globals: { theme: 'dark' } }
