import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type {
  SessionAgentLaunchProposal,
  SessionAgentProfile,
  SessionAgentRequestPayload,
} from '@superone/shared/agent-types'
import { SessionAgentsConfirmPrompt } from './SessionAgentsConfirmPrompt'

const PARENT_CWD = '/Users/me/projects/super-one'

const profiles: SessionAgentProfile[] = [
  {
    id: 'claude-base',
    name: 'Claude',
    harnessId: 'claude',
    brandKey: 'claude',
    defaultConfig: { model: 'claude-sonnet', effort: 'medium' },
    models: [
      { id: 'claude-sonnet', name: 'Claude Sonnet' },
      { id: 'claude-opus', name: 'Claude Opus' },
    ],
    efforts: ['low', 'medium', 'high'],
    apiProviders: [
      { id: 'anthropic', name: 'Anthropic' },
      { id: 'relay', name: 'Team Relay' },
    ],
  },
  {
    id: 'codex-base',
    name: 'Codex',
    harnessId: 'codex',
    brandKey: 'codex',
    defaultConfig: { model: 'gpt-5.4', effort: 'high' },
    models: [{ id: 'gpt-5.4', name: 'GPT-5.4' }],
    efforts: ['medium', 'high', 'xhigh'],
    apiProviders: [{ id: 'openai', name: 'OpenAI' }],
  },
  {
    id: 'acp-base',
    name: 'Grok',
    harnessId: 'acp',
    acpAgentId: 'grok-build',
    brandKey: 'acp-grok',
    defaultConfig: { model: 'grok-4.5', effort: 'high' },
    models: [{ id: 'grok-4.5', name: 'Grok 4.5' }],
    efforts: ['low', 'high'],
    apiProviders: [],
  },
  {
    id: 'opencode-base',
    name: 'OpenCode',
    harnessId: 'opencode',
    brandKey: 'opencode',
    defaultConfig: { model: 'kimi-k2' },
    models: [{ id: 'kimi-k2', name: 'Kimi K2' }],
    efforts: [],
    apiProviders: [],
  },
]

function launch(
  launchId: string,
  agentId: string,
  task: string,
  config: SessionAgentLaunchProposal['config'],
  opts?: { name?: string; role?: string },
): SessionAgentLaunchProposal {
  const name = opts?.name
  const role = opts?.role
  return {
    launchId,
    agentId,
    task,
    ...(name ? { name } : {}),
    ...(role ? { role } : {}),
    config: {
      cwd: PARENT_CWD,
      sandboxMode: 'off',
      permissionMode: 'default',
      ...(name ? { name } : {}),
      ...(role ? { role } : {}),
      ...config,
    },
  }
}

const payload: SessionAgentRequestPayload = {
  profiles,
  launches: [
    launch('review-tests', 'claude-base', 'Review the focused test failures and report the root cause. Do not edit files.', {
      model: 'claude-sonnet',
      effort: 'medium',
      sandboxMode: 'on',
    }),
    launch('inspect-types', 'codex-base', 'Inspect the current typecheck errors and classify existing versus new failures.', {
      model: 'gpt-5.4',
      effort: 'high',
      permissionMode: 'bypassPermissions',
      worktree: { enabled: true, baseBranch: 'main', mode: 'branch', branchName: 'agent/typecheck-review' },
    }),
  ],
}

function Harness({ value = payload, width = 680 }: { value?: SessionAgentRequestPayload; width?: number }) {
  const [result, setResult] = useState('')
  return (
    <div className="@container" style={{ width, maxWidth: '100%' }}>
      <SessionAgentsConfirmPrompt
        payload={value}
        onConfirm={(launches) => setResult(JSON.stringify(launches, null, 2))}
        onReject={() => setResult('rejected')}
      />
      {result && <pre className="mx-3 whitespace-pre-wrap break-all rounded-md bg-muted p-2 text-[10px]">{result}</pre>}
    </div>
  )
}

const meta: Meta<typeof Harness> = {
  title: 'AgentCollaboration/ConfirmPrompt',
  component: Harness,
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj<typeof Harness>

export const MultipleAgents: Story = {}

export const NarrowChat: Story = { args: { width: 380 } }

/** Narrow + many agents: the tab strip scrolls while the ⇥ hint stays pinned on the right. */
export const NarrowManyAgents: Story = {
  args: {
    width: 320,
    value: {
      profiles,
      launches: Array.from({ length: 5 }, (_, index) =>
        launch(`narrow-${index}`, index % 2 ? 'codex-base' : 'claude-base', `Task number ${index + 1}.`, {
          model: index % 2 ? 'gpt-5.4' : 'claude-sonnet',
        }),
      ),
    },
  },
}

export const SingleAgent: Story = {
  args: { value: { ...payload, launches: payload.launches.slice(0, 1) } },
}

/**
 * One tab per harness — each shows its own permission vocabulary:
 * Claude modes, Codex presets, Grok/ACP baselines, OpenCode's subset.
 */
export const EveryHarness: Story = {
  args: {
    value: {
      profiles,
      launches: [
        launch('h-claude', 'claude-base', 'Claude runs the full permission-mode list.', { model: 'claude-sonnet', permissionMode: 'plan' }, { name: 'PlannerBot', role: 'Planner' }),
        launch('h-codex', 'codex-base', 'Codex shows sandbox presets instead of permission modes.', { model: 'gpt-5.4', permissionMode: 'bypassPermissions' }, { name: 'CoderBot', role: 'Coder' }),
        launch('h-grok', 'acp-base', 'Grok shows the ACP ask/plan/auto/always baselines.', { model: 'grok-4.5', permissionMode: 'auto' }, { name: 'DiffBot', role: 'Reviewer' }),
        launch('h-opencode', 'opencode-base', 'OpenCode shows only the modes its backend implements.', { model: 'kimi-k2', permissionMode: 'dontAsk' }, { name: 'Scout', role: 'Explorer' }),
      ],
    },
  },
}

/** Tabs stay harness (Grok / Grok 2); content header shows agent-chosen Name - Role. */
export const GrokRoles: Story = {
  args: {
    value: {
      profiles,
      launches: [
        launch('alpha', 'acp-base', 'You are Reviewer. Review the diff and report issues only.', { model: 'grok-4.5' }, { name: 'DiffBot', role: 'Reviewer' }),
        launch('beta', 'acp-base', 'You are Implementer. Apply the approved fix.', { model: 'grok-4.5' }, { name: 'FixBot', role: 'Implementer' }),
      ],
    },
  },
}

/**
 * Every working-location the agent can request. `attach` and `branch` are deliberately
 * near-identical on screen — both end up on a named branch; only the tooltip differs.
 */
export const WorkingLocations: Story = {
  args: {
    value: {
      profiles,
      launches: [
        launch('loc-parent', 'claude-base', 'Runs in the parent session\'s own working directory — no worktree.', {
          model: 'claude-sonnet',
        }),
        launch('loc-branch', 'claude-base', 'Runs in a fresh worktree on a newly created branch.', {
          model: 'claude-sonnet',
          worktree: { enabled: true, baseBranch: 'main', mode: 'branch', branchName: 'agent/refactor', carryLocalChanges: true },
        }),
        launch('loc-detach', 'claude-base', 'Runs in a detached worktree — no branch of its own.', {
          model: 'claude-sonnet',
          worktree: { enabled: true, baseBranch: 'main', mode: 'detach' },
        }),
        launch('loc-attach', 'claude-base', 'Runs in a worktree attached to an existing branch.', {
          model: 'claude-sonnet',
          worktree: { enabled: true, baseBranch: 'main', mode: 'attach', branchName: 'feat/multi-agents-collab' },
        }),
        launch('loc-nested', 'codex-base', 'Runs in a nested sub-package directory.', {
          model: 'gpt-5.4',
          cwd: '/Users/me/projects/super-one/apps/desktop',
        }),
      ],
    },
  },
}

/** Many launches: the tab strip scrolls horizontally instead of stacking editors vertically. */
export const ManyAgents: Story = {
  args: {
    value: {
      profiles,
      launches: Array.from({ length: 6 }, (_, index) =>
        launch(`launch-${index}`, index % 2 ? 'codex-base' : 'claude-base', `${payload.launches[index % 2].task} (#${index + 1})`, {
          model: index % 2 ? 'gpt-5.4' : 'claude-sonnet',
        }),
      ),
    },
  },
}
