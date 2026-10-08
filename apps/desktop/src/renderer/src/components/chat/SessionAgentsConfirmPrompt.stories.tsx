import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import type { RemoteAgentProfiles, SessionAgentProfile, SessionAgentRequestPayload } from '@superone/shared/agent-types'
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
  summary?: string
  extraProfiles?: SessionAgentProfile[]
}): SessionAgentRequestPayload {
  return {
    profiles: [CODEX_PROFILE, ...(overrides?.extraProfiles ?? [])],
    launches: [
      {
        launchId: 'classify-typecheck',
        agentId: 'codex-base',
        summary: overrides?.summary ?? 'Classify typecheck errors',
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

/** The target machine's own Claude, with models and keys this machine does not have. */
const STUDIO_CLAUDE: SessionAgentProfile = {
  id: 'claude-base',
  name: 'Claude',
  harnessId: 'claude',
  defaultConfig: { model: 'claude-sonnet-4-5', effort: 'high' },
  models: [
    { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
    { id: 'claude-opus', name: 'Claude Opus' },
    { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
  ],
  efforts: ['low', 'medium', 'high', 'max'],
  apiProviders: [{ id: 'studio-bedrock', name: 'Amazon Bedrock', brand: 'aws', keyName: 'Studio team account' }],
}

const LONG_NAMES_CLAUDE: SessionAgentProfile = {
  ...STUDIO_CLAUDE,
  defaultConfig: { model: 'claude-sonnet-4-5-20250929-extended-context-preview', effort: 'high' },
  models: [
    { id: 'claude-sonnet-4-5-20250929-extended-context-preview', name: 'Claude Sonnet 4.5 (1M context, extended thinking preview build)' },
    ...STUDIO_CLAUDE.models,
  ],
  apiProviders: [{ id: 'studio-gateway', name: 'Enterprise LLM Gateway (us-east-1 production)', keyName: 'Build farm shared account for nightly agents' }],
}

/**
 * What `window.environment.remoteAgentProfiles` answers for the target machine:
 * its catalog, a load that never finishes, a failure (a retry then loads), a
 * node too old to list one, or a catalog without models for the agent.
 */
type RemoteCatalogMock = 'ready' | 'loading' | 'error' | 'unsupported' | 'no-models' | 'long-names'

function remoteCatalogAnswer(mock: RemoteCatalogMock, attempt: number): Promise<RemoteAgentProfiles> {
  switch (mock) {
    case 'loading':
      return new Promise(() => {})
    case 'error':
      return attempt === 1
        ? Promise.reject(new Error("Error invoking remote method 'environment:remoteAgentProfiles': Error: Studio Mac is not connected"))
        : Promise.resolve({ supported: true, profiles: [STUDIO_CLAUDE] })
    case 'unsupported':
      return Promise.resolve({ supported: false })
    case 'no-models':
      return Promise.resolve({ supported: true, profiles: [{ ...STUDIO_CLAUDE, models: [], defaultConfig: {} }] })
    case 'long-names':
      return Promise.resolve({ supported: true, profiles: [LONG_NAMES_CLAUDE] })
    default:
      return Promise.resolve({ supported: true, profiles: [STUDIO_CLAUDE] })
  }
}

const meta: Meta<typeof SessionAgentsConfirmPrompt> = {
  title: 'Tool UI/Collaboration/Session Agents Confirm',
  component: SessionAgentsConfirmPrompt,
  parameters: { layout: 'padded', remoteCatalog: 'ready' satisfies RemoteCatalogMock },
  args: { onConfirm: () => {}, onReject: () => {} },
  decorators: [(Story) => <StoryShell width={820}><Story /></StoryShell>],
  beforeEach: ({ parameters }) => {
    const previousApi = window.environment
    let attempt = 0
    window.environment = {
      ...previousApi,
      remoteAgentProfiles: async () => remoteCatalogAnswer(parameters.remoteCatalog as RemoteCatalogMock, ++attempt),
    }
    return () => { window.environment = previousApi }
  },
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

/**
 * The summary is all the user approves (the brief goes to session_collab_start).
 * It clamps to two lines; click it to expand.
 */
export const LongSummary: Story = {
  args: { payload: codexPayload({ summary: 'Group the typecheck failures by root cause and report which ones share a fix. Start with the renderer package, then the shared contracts; skip generated files. Flag anything that looks like a stale build artifact rather than a real type error, and list the files each group touches so the fixes can be split across reviewers.' }) },
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

function remotePayload(
  remote: Partial<NonNullable<SessionAgentRequestPayload['launches'][number]['config']['remote']>>,
  model?: string,
): SessionAgentRequestPayload {
  return {
    profiles: [CLAUDE_PROFILE],
    launches: [
      {
        launchId: 'remote-impl',
        agentId: 'claude-base',
        summary: 'Implement the export command on the build machine and push a branch',
        name: 'Builder',
        role: 'Implementer',
        config: {
          ...(model ? { model } : {}),
          permissionMode: 'bypassPermissions',
          sandboxMode: 'off',
          remote: {
            environmentId: 'env-b',
            label: 'Studio Mac',
            repository: 'github.com/acme/app',
            cloneUrl: 'git@github.com:acme/app.git',
            projectId: 'p-app',
            projectPath: '/Users/build/code/app',
            baseRef: 'origin/feat/export',
            unpushedCommits: 0,
            uncommittedChanges: 0,
            ...remote,
          },
        },
      },
    ],
  }
}

/**
 * Launch on another machine that already has the repository. The model, effort and
 * key pickers list that machine's own catalog, preselected on its default model.
 */
export const RemoteExistingCheckout: Story = {
  args: { payload: remotePayload({}) },
}

/** The agent asked for a model the target offers; it stays selected. */
export const RemoteRequestedModel: Story = {
  args: { payload: remotePayload({}, 'claude-opus') },
}

/** The agent asked for a model the target lacks: a warning, and the target's default is selected instead. */
export const RemoteRequestedModelUnavailable: Story = {
  args: { payload: remotePayload({}, 'claude-3-opus-legacy') },
}

/** The target's catalog is still loading; approving now runs the child on the target's defaults. */
export const RemoteCatalogLoading: Story = {
  args: { payload: remotePayload({}) },
  parameters: { remoteCatalog: 'loading' },
}

/** Loading the target's catalog failed; the retry button loads it (the mock succeeds on retry). */
export const RemoteCatalogError: Story = {
  args: { payload: remotePayload({}) },
  parameters: { remoteCatalog: 'error' },
}

/** The target runs an older SuperOne without a catalog: the agent's model or the target's default, explained in the tooltip. */
export const RemoteOlderNode: Story = {
  args: { payload: remotePayload({}, 'claude-opus') },
  parameters: { remoteCatalog: 'unsupported' },
}

/** The target lists no models for this agent; the child uses the target's configured model. */
export const RemoteNoModels: Story = {
  args: { payload: remotePayload({}) },
  parameters: { remoteCatalog: 'no-models' },
}

/** Long machine, model and key names truncate inside the settings row. */
export const RemoteLongNames: Story = {
  args: { payload: remotePayload({ label: 'Build Farm Mac Studio (Rack 3, Shanghai office, nightly agents)' }) },
  parameters: { remoteCatalog: 'long-names' },
}

/** Dark theme with the target's pickers and an unavailable-model warning. */
export const RemoteDark: Story = {
  args: { payload: remotePayload({ unpushedCommits: 2, uncommittedChanges: 1 }, 'claude-3-opus-legacy') },
  globals: { theme: 'dark' },
}

/** Chinese copy in a narrow chat, while the target's catalog fails to load. */
export const RemoteChineseNarrow: Story = {
  args: { payload: remotePayload({}, 'claude-3-opus-legacy') },
  parameters: { remoteCatalog: 'error' },
  globals: { locale: 'zh' },
  decorators: [(Story) => <StoryShell width={360}><Story /></StoryShell>],
}

/** Chinese copy with the target's pickers loaded and an unavailable-model warning. */
export const RemoteChinese: Story = {
  args: { payload: remotePayload({}, 'claude-3-opus-legacy') },
  globals: { locale: 'zh' },
}

/** The target lacks the repository and clones it; this checkout has unpushed and uncommitted work. */
export const RemoteCloneWithUnpushedWork: Story = {
  args: {
    payload: remotePayload({
      projectId: undefined,
      projectPath: undefined,
      cloneInto: '~/SuperOne/Projects',
      baseRef: 'origin/HEAD',
      unpushedCommits: 3,
      uncommittedChanges: 2,
    }),
  },
}

/** Narrow chat: the machine, clone and branch chips wrap and the warning stays readable. */
export const RemoteNarrow: Story = {
  args: { payload: remotePayload({ projectId: undefined, projectPath: undefined, cloneInto: '~/SuperOne/Projects', unpushedCommits: 1, uncommittedChanges: 0 }) },
  decorators: [(Story) => <StoryShell width={360}><Story /></StoryShell>],
}
