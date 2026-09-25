/**
 * Storybook: Settings → Harnesses → Agents tab. Agent listing and definition
 * reads are mocked, so rows expand without a real ~/.claude/agents directory.
 */
import type { ReactElement } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import i18n from 'i18next'
import type { AgentInfo } from '@superone/shared/agent-types'
import { mockIpc } from '../../../../.storybook/mock-ipc'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import { AgentsPage } from './AgentsPage'

type ScopedAgent = AgentInfo & { scope: 'user' | 'project' }

const AGENTS: ScopedAgent[] = [
  { name: 'code-reviewer', description: 'Reviews the current diff for correctness, security and style issues.', model: 'opus', source: 'user', scope: 'user' },
  { name: 'test-writer', description: 'Writes focused unit tests for changed code paths.', model: 'sonnet', source: 'user', scope: 'user' },
  { name: 'docs-helper', description: '', source: 'user', scope: 'user' },
  { name: 'release-captain', description: 'Walks through the project release checklist.', source: 'project', scope: 'project' },
]

const LONG_TEXT = 'Investigates flaky integration tests across the monorepo, bisects recent commits, reads CI logs, reproduces failures locally with the recorded fixtures and proposes a minimal fix together with a regression test that pins the root cause rather than the symptom.'

const LONG_AGENTS: ScopedAgent[] = Array.from({ length: 12 }, (_, i) => ({
  name: `enterprise-compliance-and-governance-review-agent-${i + 1}`,
  description: LONG_TEXT,
  model: i % 2 === 0 ? 'claude-opus-4-1-20250805[1m]' : undefined,
  source: 'user',
  scope: 'user',
}))

const DEFINITION = `---
name: code-reviewer
model: opus
---

# Code reviewer

Review the diff for:

- correctness and edge cases
- security (injection, secrets)
- naming and structure
`

function seed(agents: ScopedAgent[]) {
  return (Story: () => ReactElement) => {
    mockIpc('app', 'listAgents', async () => agents)
    mockIpc('app', 'readAgentFile', async () => DEFINITION)
    useAppStore.setState({ settingsProvider: 'claude', currentFolder: '/Users/demo/projects/superone' })
    useSettingsStore.setState({ agents: [], agentContent: null, agentContentName: null })
    return <Story />
  }
}

const meta: Meta<typeof AgentsPage> = {
  title: 'Settings/Harnesses/Agents',
  component: AgentsPage,
  parameters: { layout: 'fullscreen' },
  decorators: [
    // Mirrors the Harnesses detail column, which owns the padding.
    (Story) => (
      <div className="min-h-[720px] bg-background px-7 pt-5 pb-8 text-foreground">
        <div className="mx-auto max-w-3xl">
          <Story />
        </div>
      </div>
    ),
  ],
}
export default meta

type Story = StoryObj<typeof AgentsPage>

const body = (canvasElement: HTMLElement) => within(canvasElement.ownerDocument.body)

export const Populated: Story = {
  decorators: [seed(AGENTS)],
  play: async ({ canvasElement }) => {
    await expect(await body(canvasElement).findByText('code-reviewer')).toBeInTheDocument()
  },
}

/** Clicking a row reads its definition and expands it in place. */
export const Expanded: Story = {
  decorators: [seed(AGENTS)],
  play: async ({ canvasElement }) => {
    const screen = body(canvasElement)
    await userEvent.click(await screen.findByText('code-reviewer'))
    await expect(await screen.findByText('Code reviewer')).toBeInTheDocument()
  },
}

export const ProjectScope: Story = {
  decorators: [seed(AGENTS)],
  play: async ({ canvasElement }) => {
    const screen = body(canvasElement)
    await userEvent.click(await screen.findByRole('button', { name: i18n.t('resources.sectionProject') }))
    await expect(await screen.findByText('release-captain')).toBeInTheDocument()
  },
}

export const Empty: Story = {
  decorators: [seed([])],
}

export const LongContent: Story = {
  decorators: [seed(LONG_AGENTS)],
}

export const Narrow: Story = {
  decorators: [
    seed(AGENTS),
    (Story) => (
      <div className="max-w-[420px]">
        <Story />
      </div>
    ),
  ],
}
