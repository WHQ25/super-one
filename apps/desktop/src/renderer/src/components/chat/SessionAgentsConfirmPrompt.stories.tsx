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
  summary: string,
  task: string,
  config: SessionAgentLaunchProposal['config'],
  opts: { name: string; role: string },
): SessionAgentLaunchProposal {
  const { name, role } = opts
  return {
    launchId,
    mode: 'spawn',
    agentId,
    summary,
    task,
    name,
    role,
    config: {
      cwd: PARENT_CWD,
      sandboxMode: 'off',
      permissionMode: 'default',
      name,
      role,
      ...config,
    },
  }
}

/** Link to an already-existing session — no model/permission editors; tab shows peer harness. */
function linkLaunch(
  launchId: string,
  opts: {
    sessionId: string
    summary: string
    task?: string
    peerTitle: string
    peerProjectPath?: string
    peerHarnessId: string
    peerHarnessName: string
    peerBrandKey?: string
    peerAcpAgentId?: string
    name?: string
    role?: string
  },
): SessionAgentLaunchProposal {
  const name = opts.name ?? opts.peerTitle
  const role = opts.role ?? 'Peer'
  return {
    launchId,
    mode: 'link',
    agentId: '',
    sessionId: opts.sessionId,
    peerTitle: opts.peerTitle,
    peerProjectPath: opts.peerProjectPath ?? PARENT_CWD,
    peerHarnessId: opts.peerHarnessId,
    peerHarnessName: opts.peerHarnessName,
    ...(opts.peerBrandKey ? { peerBrandKey: opts.peerBrandKey } : {}),
    ...(opts.peerAcpAgentId ? { peerAcpAgentId: opts.peerAcpAgentId } : {}),
    summary: opts.summary,
    task: opts.task ?? '',
    name,
    role,
    config: { name, role, summary: opts.summary },
  }
}

const payload: SessionAgentRequestPayload = {
  profiles,
  launches: [
    launch(
      'review-tests',
      'claude-base',
      'Review focused test failures',
      [
        '## Task',
        'Review the focused test failures and report the root cause.',
        '',
        '- Inspect the failing suite',
        '- List root causes with `file:line`',
        '- Do **not** edit files',
      ].join('\n'),
      {
        model: 'claude-sonnet',
        effort: 'medium',
        sandboxMode: 'on',
      },
      { name: 'DiffBot', role: 'Reviewer' },
    ),
    launch(
      'inspect-types',
      'codex-base',
      'Classify typecheck errors',
      'Inspect the current typecheck errors and classify existing versus new failures.',
      {
        model: 'gpt-5.4',
        effort: 'high',
        permissionMode: 'bypassPermissions',
        worktree: { enabled: true, baseBranch: 'main', mode: 'branch', branchName: 'agent/typecheck-review' },
      },
      { name: 'TypeBot', role: 'Analyst' },
    ),
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
        launch(
          `narrow-${index}`,
          index % 2 ? 'codex-base' : 'claude-base',
          `Task ${index + 1}`,
          `Task number ${index + 1}.`,
          { model: index % 2 ? 'gpt-5.4' : 'claude-sonnet' },
          { name: `Agent ${index + 1}`, role: 'Worker' },
        ),
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
        launch('h-claude', 'claude-base', 'Claude permission modes', 'Claude runs the full permission-mode list.', { model: 'claude-sonnet', permissionMode: 'plan' }, { name: 'PlannerBot', role: 'Planner' }),
        launch('h-codex', 'codex-base', 'Codex sandbox presets', 'Codex shows sandbox presets instead of permission modes.', { model: 'gpt-5.4', permissionMode: 'bypassPermissions' }, { name: 'CoderBot', role: 'Coder' }),
        launch('h-grok', 'acp-base', 'Grok ACP baselines', 'Grok shows the ACP ask/plan/auto/always baselines.', { model: 'grok-4.5', permissionMode: 'auto' }, { name: 'DiffBot', role: 'Reviewer' }),
        launch('h-opencode', 'opencode-base', 'OpenCode mode subset', 'OpenCode shows only the modes its backend implements.', { model: 'kimi-k2', permissionMode: 'dontAsk' }, { name: 'Scout', role: 'Explorer' }),
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
        launch('alpha', 'acp-base', 'Review the diff (read-only)', 'You are Reviewer. Review the diff and report issues only.', { model: 'grok-4.5' }, { name: 'DiffBot', role: 'Reviewer' }),
        launch('beta', 'acp-base', 'Apply the approved fix', 'You are Implementer. Apply the approved fix.', { model: 'grok-4.5' }, { name: 'FixBot', role: 'Implementer' }),
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
        launch('loc-parent', 'claude-base', 'Parent working directory', 'Runs in the parent session\'s own working directory — no worktree.', {
          model: 'claude-sonnet',
        }, { name: 'ParentBot', role: 'Worker' }),
        launch('loc-branch', 'claude-base', 'Fresh branch worktree', 'Runs in a fresh worktree on a newly created branch.', {
          model: 'claude-sonnet',
          worktree: { enabled: true, baseBranch: 'main', mode: 'branch', branchName: 'agent/refactor', carryLocalChanges: true },
        }, { name: 'BranchBot', role: 'Worker' }),
        launch('loc-detach', 'claude-base', 'Detached worktree', 'Runs in a detached worktree — no branch of its own.', {
          model: 'claude-sonnet',
          worktree: { enabled: true, baseBranch: 'main', mode: 'detach' },
        }, { name: 'DetachBot', role: 'Worker' }),
        launch('loc-attach', 'claude-base', 'Attach existing branch', 'Runs in a worktree attached to an existing branch.', {
          model: 'claude-sonnet',
          worktree: { enabled: true, baseBranch: 'main', mode: 'attach', branchName: 'feat/multi-agents-collab' },
        }, { name: 'AttachBot', role: 'Worker' }),
        launch('loc-nested', 'codex-base', 'Nested sub-package cwd', 'Runs in a nested sub-package directory.', {
          model: 'gpt-5.4',
          cwd: '/Users/me/projects/super-one/apps/desktop',
        }, { name: 'NestedBot', role: 'Worker' }),
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
        launch(
          `launch-${index}`,
          index % 2 ? 'codex-base' : 'claude-base',
          payload.launches[index % 2].summary,
          `${payload.launches[index % 2].task} (#${index + 1})`,
          { model: index % 2 ? 'gpt-5.4' : 'claude-sonnet' },
          { name: `Agent ${index + 1}`, role: 'Worker' },
        ),
      ),
    },
  },
}

/**
 * Link mode: work with an existing session. Tab shows peer harness (Claude);
 * body is `Work with: {title}` (title clickable) — no model/permission editors.
 */
export const LinkExistingSession: Story = {
  args: {
    value: {
      profiles,
      launches: [
        linkLaunch('link-review', {
          sessionId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          peerTitle: 'API review session',
          summary: 'Align with the existing review session on request/response types',
          task: [
            '## Opening',
            'Please confirm the request body shape for the new endpoint.',
            '',
            '- Field names',
            '- Optional vs required',
            '- Error envelope',
          ].join('\n'),
          peerHarnessId: 'claude',
          peerHarnessName: 'Claude',
          peerBrandKey: 'claude',
        }),
      ],
    },
  },
}

/** Link with no opening task — wake-only path; summary still shown. */
export const LinkWakeOnly: Story = {
  args: {
    value: {
      profiles,
      launches: [
        linkLaunch('link-wake', {
          sessionId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          peerTitle: 'Implementer worktree',
          summary: 'Open a mailbox so we can hand off the final PR checklist',
          peerProjectPath: '/Users/me/projects/other-app',
          peerHarnessId: 'codex',
          peerHarnessName: 'Codex',
          peerBrandKey: 'codex',
        }),
      ],
    },
  },
}

/**
 * Mixed batch: spawn child + work-with existing. Tabs are both harness labels
 * (Claude / Grok); only the spawn tab has model/permission editors.
 */
export const MixedSpawnAndLink: Story = {
  args: {
    value: {
      profiles,
      launches: [
        launch(
          'spawn-impl',
          'claude-base',
          'Implement the API change',
          'Implement the API change and run focused tests.',
          {
            model: 'claude-sonnet',
            effort: 'high',
            permissionMode: 'bypassPermissions',
            worktree: {
              enabled: true,
              baseBranch: 'main',
              mode: 'branch',
              branchName: 'feat/api-change',
            },
          },
          { name: 'Alice', role: 'Implementer' },
        ),
        linkLaunch('link-peer', {
          sessionId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
          peerTitle: 'Earlier design thread',
          summary: 'Sync design decisions with the existing Grok session',
          task: 'Please restate the agreed API contract before Alice lands the change.',
          peerHarnessId: 'acp',
          peerHarnessName: 'Grok',
          peerBrandKey: 'acp-grok',
          peerAcpAgentId: 'grok-build',
        }),
      ],
    },
  },
}

/** Two link launches — tabs show peer harnesses (Codex / Claude), not peer titles. */
export const MultipleLinks: Story = {
  args: {
    value: {
      profiles,
      launches: [
        linkLaunch('link-a', {
          sessionId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
          peerTitle: 'Typecheck cleanup',
          summary: 'Ask the typecheck session for remaining errors',
          task: 'List remaining `tsc` errors with file:line.',
          peerHarnessId: 'codex',
          peerHarnessName: 'Codex',
          peerBrandKey: 'codex',
        }),
        linkLaunch('link-b', {
          sessionId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
          peerTitle: 'Docs pass',
          summary: 'Pull the docs outline from the writing session',
          peerHarnessId: 'claude',
          peerHarnessName: 'Claude',
          peerBrandKey: 'claude',
        }),
      ],
    },
  },
}
