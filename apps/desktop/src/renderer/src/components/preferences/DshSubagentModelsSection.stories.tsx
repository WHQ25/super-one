import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ReactNode } from 'react'
import { expect, userEvent, within } from 'storybook/test'
import type { DshSubagentModelSelection } from '@superone/shared/agent-types'
import { mockIpc } from '../../../../../.storybook/mock-ipc'
import { SettingsCard } from '../settings/SettingsSection'
import { DshSubagentModelsSection, DshSubagentModelsSettings, type DshModelRoute } from './DshSubagentModelsSection'

const CATALOG: DshModelRoute[] = [
  { provider: 'deepseek-official', model: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
  { provider: 'deepseek-official', model: 'deepseek-flash', name: 'DeepSeek V4.1 Flash' },
]

const LONG_CATALOG: DshModelRoute[] = [
  ...CATALOG,
  {
    provider: 'deepseek-official',
    model: 'deepseek-v4-pro-experimental-long-context-reasoning-2026-09-preview',
    name: 'DeepSeek V4 Pro Experimental Long-Context Reasoning Preview Build',
  },
]

/** The card the section renders inside on the preferences page. */
function Card({ children, width }: { children: ReactNode; width?: number }) {
  return (
    <div style={width ? { width } : undefined}>
      <SettingsCard>{children}</SettingsCard>
    </div>
  )
}

/** Holds the value, so toggling in a story behaves like the saved setting. */
function Stateful({ initial, models, width }: {
  initial: DshSubagentModelSelection | null
  models: DshModelRoute[] | null
  width?: number
}) {
  const [value, setValue] = useState(initial)
  return (
    <Card width={width}>
      <DshSubagentModelsSection value={value} models={models} onChange={setValue} />
    </Card>
  )
}

const meta: Meta<typeof Stateful> = {
  title: 'Settings/Preferences/DeepSeek Subagent Models',
  component: Stateful,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div className="max-w-2xl"><Story /></div>],
}

export default meta
type Story = StoryObj<typeof Stateful>

/** Settings and catalog still loading: the switch is inert. */
export const Loading: Story = {
  args: { initial: null, models: null },
}

/** Off, the default: the list is shown but cannot be edited. */
export const Off: Story = {
  args: { initial: { enabled: false, allowedModels: [] }, models: CATALOG },
}

/** On, with one model allowed. */
export const Enabled: Story = {
  args: {
    initial: { enabled: true, allowedModels: [{ provider: 'deepseek-official', model: 'deepseek-flash' }] },
    models: CATALOG,
  },
}

/** On with nothing allowed — a warning explains the agent still cannot choose. */
export const EnabledNoneSelected: Story = {
  args: { initial: { enabled: true, allowedModels: [] }, models: CATALOG },
}

/** No catalog (no API key, or the tree failed to boot). */
export const NoModels: Story = {
  args: { initial: { enabled: true, allowedModels: [] }, models: [] },
}

/** Long names truncate in a narrow card instead of pushing the checkbox out. */
export const LongNamesNarrow: Story = {
  args: {
    initial: { enabled: true, allowedModels: [{ provider: 'deepseek-official', model: 'deepseek-v4-pro' }] },
    models: LONG_CATALOG,
    width: 320,
  },
}

/** Turning the preference on and allowing a model, as a user would. */
export const TurnOnAndAllow: Story = {
  args: { initial: { enabled: false, allowedModels: [] }, models: CATALOG },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('switch'))
    await expect(canvas.getByText(/Select at least one model|至少选择一个模型/)).toBeInTheDocument()
    await userEvent.click(canvas.getByLabelText(/DeepSeek V4 Pro/))
    await expect(canvas.queryByText(/Select at least one model|至少选择一个模型/)).not.toBeInTheDocument()
  },
}

let saved: DshSubagentModelSelection = { enabled: true, allowedModels: [{ provider: 'deepseek-official', model: 'deepseek-v4-pro' }] }
mockIpc('app', 'getAppSettings', async () => ({ dshSubagentModelSelection: saved }))
mockIpc('app', 'saveAppSettings', async (patch: unknown) => {
  saved = (patch as { dshSubagentModelSelection: DshSubagentModelSelection }).dshSubagentModelSelection
  return { dshSubagentModelSelection: saved }
})
mockIpc('app', 'connectDeepseek', async () => ({
  models: CATALOG.map((route) => ({ id: route.model, name: route.name, description: route.provider, provider: route.provider })),
}))

/** Wired to app settings and the live catalog, as on the preferences page. */
export const Wired: StoryObj = {
  render: () => (
    <Card>
      <DshSubagentModelsSettings />
    </Card>
  ),
}
