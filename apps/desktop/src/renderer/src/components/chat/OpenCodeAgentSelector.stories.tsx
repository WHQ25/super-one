import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { OpenCodeAgentOption } from '@superone/shared/agent-types'
import { OpenCodeAgentPicker } from './OpenCodeAgentSelector'
import { PermissionModePopover } from './PermissionModePopover'

const agents: OpenCodeAgentOption[] = [
  { id: 'build', name: 'Build', description: 'Implement changes using your configured permissions.' },
  { id: 'plan', name: 'Plan', description: 'Explore the project and prepare a plan.' },
  { id: 'team/reviewer', name: 'Team Reviewer', description: 'A custom primary agent from OpenCode.' },
]

/** A running session lists its project's own agents (`session_agents`), not only the global catalog. */
const projectAgents: OpenCodeAgentOption[] = [
  ...agents,
  { id: 'local-docs', name: 'Local Docs', description: 'Defined in this project under .opencode/agent/.' },
]

function Preview({ empty = false, fail = false, compact = false, long = false, project = false }: {
  empty?: boolean; fail?: boolean; compact?: boolean; long?: boolean; project?: boolean
}) {
  const { t } = useTranslation()
  const [value, setValue] = useState<string | null>(project ? 'local-docs' : 'plan')
  const [catalog, setCatalog] = useState(empty ? [] : project ? projectAgents : long ? [...agents, {
    id: 'long', name: 'A Very Long Custom Agent Name for Narrow Chat Panes',
    description: 'This long description demonstrates wrapping in the agent popover on a narrow chat panel.',
  }] : agents)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const refresh = async () => {
    setLoading(true); setError(null)
    await new Promise((resolve) => setTimeout(resolve, 700))
    setLoading(false); setAttempt((n) => n + 1)
    if (fail && attempt === 0) setError(t('chat.opencode.agentsRefreshFailed'))
    else setCatalog(agents)
  }
  return <div className="flex min-h-96 w-72 items-end rounded-lg border bg-background p-4">
    <OpenCodeAgentPicker agents={catalog} value={value} onChange={setValue} compact={compact}
      loading={loading} error={error} onRefresh={() => void refresh()} />
  </div>
}

const meta: Meta<typeof OpenCodeAgentPicker> = {
  title: 'Chat/OpenCodeAgentSelector', component: OpenCodeAgentPicker, parameters: { layout: 'padded' },
}
export default meta
type Story = StoryObj<typeof OpenCodeAgentPicker>
export const NativeAgents: Story = { render: () => <Preview /> }
export const EmptyAndRefresh: Story = { render: () => <Preview empty /> }
export const FailedRefreshAndRetry: Story = { render: () => <Preview empty fail /> }
export const Compact: Story = { render: () => <Preview compact /> }
export const ProjectAgents: Story = { render: () => <Preview project /> }
export const LongNames: Story = { render: () => <Preview long /> }

export const PermissionStyleComparison: Story = {
  render: () => <div className="flex min-h-96 items-end gap-4 rounded-lg border bg-background p-4">
    <PermissionModePopover activeMode="plan" availableModes={['default', 'plan']} onSelect={() => {}} />
    <Preview />
  </div>,
}
export const Dark: Story = { render: () => <div className="dark"><Preview /></div> }
