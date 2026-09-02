import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import type { SessionAgentProfile, SessionAgentRequestPayload } from '@superone/shared/agent-types'
import { SessionAgentsConfirmPrompt } from './SessionAgentsConfirmPrompt'

/** Tab shortcuts only arm inside [data-chat-root]; the container query drives the hint row. */
function StoryShell({ children, width = 720 }: { children: ReactNode; width?: number }) {
  return (
    <div data-chat-root="" tabIndex={-1} className="@container" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

const CODEX_PROFILE: SessionAgentProfile = {
  id: 'codex-base',
  name: 'Codex',
  harnessId: 'codex',
  defaultConfig: { model: 'gpt-5.4-codex', effort: 'medium', fastMode: false },
  models: [
    {
      id: 'gpt-5.4-codex',
      name: 'GPT-5.4 Codex',
      serviceTiers: [{ id: 'priority', name: 'Fast', description: 'Lower latency' }],
    },
    { id: 'gpt-5.4-codex-mini', name: 'GPT-5.4 Codex mini' },
  ],
  efforts: ['low', 'medium', 'high'],
  apiProviders: [{ id: 'openai-key', name: 'OpenAI', brand: 'openai', keyName: 'codex' }],
}

const CLAUDE_PROFILE: SessionAgentProfile = {
  id: 'claude-base',
  name: 'Claude',
  harnessId: 'claude',
  defaultConfig: { model: 'claude-sonnet', effort: 'high' },
  models: [{ id: 'claude-sonnet', name: 'Claude Sonnet' }],
  efforts: ['low', 'high'],
  apiProviders: [{ id: 'anthropic', name: 'Anthropic' }],
}

function codexPayload(overrides?: {
  fastMode?: boolean
  model?: string
  extraProfiles?: SessionAgentProfile[]
}): SessionAgentRequestPayload {
  return {
    profiles: [CODEX_PROFILE, ...(overrides?.extraProfiles ?? [])],
    launches: [
      {
        launchId: 'classify-typecheck',
        agentId: 'codex-base',
        summary: 'Classify typecheck errors',
        task: 'Group the typecheck failures by root cause and report which ones share a fix.',
        name: 'TypeBot',
        role: 'Analyst',
        config: {
          cwd: '/Users/me/projects/super-one',
          model: overrides?.model ?? 'gpt-5.4-codex',
          effort: 'high',
          fastMode: overrides?.fastMode ?? false,
          permissionMode: 'plan',
          sandboxMode: 'off',
          worktree: { enabled: true, baseBranch: 'main', mode: 'branch', branchName: 'agent/types' },
        },
      },
    ],
  }
}

const meta: Meta<typeof SessionAgentsConfirmPrompt> = {
  title: 'Tool UI/Collaboration/Session Agents Confirm',
  component: SessionAgentsConfirmPrompt,
  parameters: { layout: 'padded' },
  args: { onConfirm: () => {}, onReject: () => {} },
  decorators: [(Story) => <StoryShell width={820}><Story /></StoryShell>],
}

export default meta
type Story = StoryObj<typeof SessionAgentsConfirmPrompt>

/** Fast tier available but off — the lightning glyph sits muted in front of the model name. */
export const CodexFastModeOff: Story = {
  args: { payload: codexPayload() },
}

/** Fast tier on — same glyph, brand-colored and filled. */
export const CodexFastModeOn: Story = {
  args: { payload: codexPayload({ fastMode: true }) },
}

/** A model with no Fast service tier drops the glyph entirely, like the chat-input selector does. */
export const CodexModelWithoutFastTier: Story = {
  args: { payload: codexPayload({ model: 'gpt-5.4-codex-mini' }) },
}

/** Two launches: only Codex carries the Fast glyph; Claude's toolbar is unchanged. */
export const MixedHarnesses: Story = {
  args: {
    payload: {
      profiles: [CLAUDE_PROFILE, CODEX_PROFILE],
      launches: [
        {
          launchId: 'review-tests',
          agentId: 'claude-base',
          summary: 'Review failing tests',
          task: 'Review the failing tests and report the root cause.',
          name: 'DiffBot',
          role: 'Reviewer',
          config: {
            cwd: '/Users/me/projects/super-one',
            model: 'claude-sonnet',
            effort: 'low',
            permissionMode: 'default',
            sandboxMode: 'on',
          },
        },
        codexPayload().launches[0],
      ],
    },
  },
}
