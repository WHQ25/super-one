import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import type {
  AgentProfileConfirmEditor,
  AgentProfileConfirmPayload,
  AgentProfileConfirmView,
  AgentProfileDraft,
} from '@superone/shared/agent-types'
import { AgentProfileConfirmPrompt } from './AgentProfileConfirmPrompt'

/**
 * agent_profile_apply / agent_profile_delete confirm card. Payloads are the
 * shapes `agent-profile-tools.ts` builds (see its tests); approve/deny write
 * the outcome below the card instead of touching a session.
 */

const LONG_INSTRUCTIONS = [
  '# Review protocol',
  '',
  'You review diffs; you never edit files or run commands that change the tree.',
  '',
  '1. Read the full diff and the surrounding code before commenting.',
  '2. Rank findings by severity: correctness, security, data loss, then style.',
  '3. For each finding give file:line, what breaks, and a concrete failing input.',
  '4. Say explicitly when you found nothing — do not invent nits to fill space.',
  '',
  'Project conventions live in CLAUDE.md files; read the nearest one first.',
  'When a test is missing, describe the test rather than writing it.',
].join('\n')

type Agent = NonNullable<AgentProfileConfirmEditor['agent']>
type CatalogModel = AgentProfileConfirmEditor['catalog']['models'][number]

/** The harness's built-in agent as the host sends it: its models and what an unset field launches with. */
function agent(harnessId: Agent['harnessId'], models: Array<CatalogModel & { name: string }>, defaultConfig: Agent['defaultConfig'], extra: Partial<Agent> = {}): Agent {
  return {
    id: `${harnessId}-base`, name: harnessId, harnessId, defaultConfig, apiProviders: [],
    models: models.map(({ id, name }) => ({ id, name })),
    efforts: [...new Set(models.flatMap((model) => model.supportedEffortLevels ?? []))],
    ...extra,
  }
}

/** A create card as `agent-profile-tools.ts` raises it: the read-only view plus the editor. */
function create(
  view: AgentProfileConfirmView,
  draft: AgentProfileDraft,
  base: Agent | undefined,
  models: CatalogModel[],
  host?: AgentProfileConfirmEditor['catalog']['host'],
): AgentProfileConfirmPayload {
  return {
    operation: 'create',
    profiles: [view],
    editor: { draft, ...(base ? { agent: base } : {}), catalog: { models, ...(host ? { host } : {}) } },
  }
}

const CLAUDE_MODELS = [
  { id: 'sonnet', name: 'Sonnet 5.5', supportedEffortLevels: ['low', 'medium', 'high'] as const },
  { id: 'opus', name: 'Opus 5.5', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] as const },
].map((model) => ({ ...model, supportedEffortLevels: [...model.supportedEffortLevels] }))
const CLAUDE_AGENT = agent('claude', CLAUDE_MODELS, { model: 'sonnet', effort: 'high', permissionMode: 'default' })

const CREATE = create(
  {
    harnessId: 'claude',
    name: 'Reviewer',
    description: 'Reviews diffs for correctness and security without editing files. Delegate code review here.',
    instructions: 'Never edit files. Report findings ranked by severity with file:line.',
    model: 'opus', modelName: 'Opus 5.5', effort: 'xhigh', permissionMode: 'plan', options: { ultracode: 'on' },
  },
  {
    name: 'Reviewer',
    description: 'Reviews diffs for correctness and security without editing files. Delegate code review here.',
    instructions: 'Never edit files. Report findings ranked by severity with file:line.',
    model: 'opus', effort: 'xhigh', permissionMode: 'plan', options: { ultracode: true },
  },
  CLAUDE_AGENT,
  CLAUDE_MODELS,
)

const GROK_MODELS = [
  { id: 'grok-4', name: 'Grok 4', contextWindows: [256_000, 1_000_000] },
  { id: 'grok-code', name: 'Grok Code', contextWindows: [256_000] },
]
const GROK_AGENT = agent('acp', GROK_MODELS, { model: 'grok-4', effort: 'high', permissionMode: 'default' }, { acpAgentId: 'grok-build', brandKey: 'acp-grok', efforts: ['low', 'high'] })

/** Every runtime field left to the user's default: the controls show what a launch would start with. */
const CREATE_DEFAULTS = create(
  { harnessId: 'acp', acpAgentId: 'grok-build', name: 'Grok Scout', description: 'Fast codebase exploration and summaries.', unsupported: ['mode'] },
  { name: 'Grok Scout', description: 'Fast codebase exploration and summaries.' },
  GROK_AGENT,
  GROK_MODELS,
  { lists: { mode: [] } },
)

const CREATE_LONG = create(
  { ...CREATE.profiles[0]!, name: 'Security and Correctness Reviewer for the Payments Service', instructions: LONG_INSTRUCTIONS },
  { ...CREATE.editor!.draft, name: 'Security and Correctness Reviewer for the Payments Service', instructions: LONG_INSTRUCTIONS },
  CLAUDE_AGENT,
  CLAUDE_MODELS,
)

/** Name cleared: approve stays disabled until the profile can be saved. */
const CREATE_INVALID = create(CREATE.profiles[0]!, { ...CREATE.editor!.draft, name: '' }, CLAUDE_AGENT, CLAUDE_MODELS)

const CODEX_MODELS = [{ id: 'gpt-5.6', name: 'GPT-5.6', supportedEffortLevels: ['low', 'medium', 'high'], serviceTiers: [{ id: 'priority', name: 'Fast', description: '' }] }]
const OPENCODE_MODELS = [{ id: 'anthropic/claude-sonnet-5-5', name: 'Claude Sonnet 5.5' }]
const CURSOR_MODELS = [{
  id: 'claude-opus-5-5',
  name: 'Opus 5.5',
  parameters: [
    { id: 'fast', displayName: 'Fast', values: [{ value: 'false' }, { value: 'true' }] },
    { id: 'context', displayName: 'Context', values: [{ value: '200k', displayName: '200K' }, { value: '1m', displayName: '1M' }] },
  ],
}]
const DSH_MODELS = [{ id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', supportedEffortLevels: ['high', 'max'] }]

/** One profile per harness: each card offers only that harness's own controls. */
const EVERY_HARNESS: AgentProfileConfirmPayload[] = [
  CREATE,
  create(
    { harnessId: 'codex', name: 'Speedy', description: 'Quick fixes.', model: 'gpt-5.6', effort: 'medium', options: { fastMode: 'on' } },
    { name: 'Speedy', description: 'Quick fixes.', model: 'gpt-5.6', effort: 'medium', options: { fastMode: true } },
    agent('codex', CODEX_MODELS, { model: 'gpt-5.6', effort: 'medium', permissionMode: 'default' }),
    CODEX_MODELS,
  ),
  create(
    { ...CREATE_DEFAULTS.profiles[0]!, model: 'grok-4', modelName: 'Grok 4', options: { contextWindow: '1M' } },
    { name: 'Grok Scout', description: 'Large-context exploration.', model: 'grok-4', options: { contextWindow: 1_000_000 } },
    GROK_AGENT,
    GROK_MODELS,
    { lists: { mode: [] } },
  ),
  create(
    { harnessId: 'opencode', name: 'Planner', description: 'Plans before building.', model: 'anthropic/claude-sonnet-5-5', options: { agent: 'Plan' }, unsupported: ['permissionMode'] },
    { name: 'Planner', description: 'Plans before building.', model: 'anthropic/claude-sonnet-5-5', options: { agent: 'plan' } },
    agent('opencode', OPENCODE_MODELS, { model: 'anthropic/claude-sonnet-5-5' }),
    OPENCODE_MODELS,
    { lists: { agent: [{ value: 'build', label: 'Build' }, { value: 'plan', label: 'Plan' }] } },
  ),
  create(
    { harnessId: 'cursor', name: 'Cursor Fast', description: 'Small edits on the fast tier.', model: 'claude-opus-5-5', options: { modelParams: 'Fast: On' } },
    { name: 'Cursor Fast', description: 'Small edits on the fast tier.', model: 'claude-opus-5-5', permissionMode: 'agent', options: { modelParams: { fast: 'true' } } },
    agent('cursor', CURSOR_MODELS, { model: 'claude-opus-5-5', permissionMode: 'agent' }),
    CURSOR_MODELS,
  ),
  create(
    { harnessId: 'dsh', name: 'DeepSeek Minimal', description: 'Lean tool set.', model: 'deepseek-v4-pro', options: { agentPreset: 'Minimal' } },
    { name: 'DeepSeek Minimal', description: 'Lean tool set.', model: 'deepseek-v4-pro', options: { agentPreset: 'minimal' } },
    agent('dsh', DSH_MODELS, { model: 'deepseek-v4-pro', effort: 'high', permissionMode: 'default' }),
    DSH_MODELS,
    { lists: { agentPreset: [{ value: 'minimal', label: 'Minimal' }, { value: 'full', label: 'Full' }] } },
  ),
]

const UPDATE: AgentProfileConfirmPayload = {
  operation: 'update',
  profiles: [{ ...CREATE.profiles[0]!, id: 'claude-reviewer', effort: 'max' }],
  changes: [
    { field: 'model', from: 'sonnet', to: 'opus' },
    { field: 'effort', from: 'high', to: 'max' },
    { field: 'permissionMode', from: 'default', to: 'plan' },
    { field: 'ultracode', from: 'off', to: 'on' },
  ],
}

const UPDATE_LONG: AgentProfileConfirmPayload = {
  operation: 'update',
  profiles: [{ ...CREATE.profiles[0]!, id: 'claude-reviewer', name: 'Security and Correctness Reviewer for the Payments Service', instructions: LONG_INSTRUCTIONS }],
  changes: [
    { field: 'name', from: 'Reviewer', to: 'Security and Correctness Reviewer for the Payments Service' },
    { field: 'instructions', from: 'Never edit files. Report findings ranked by severity with file:line.', to: LONG_INSTRUCTIONS },
  ],
}

const DELETE: AgentProfileConfirmPayload = {
  operation: 'delete',
  profiles: [
    { id: 'claude-reviewer', harnessId: 'claude', name: 'Reviewer', description: 'Reviews diffs.' },
    { id: 'codex-speedy', harnessId: 'codex', name: 'Speedy', description: 'Quick fixes on the fast tier.' },
  ],
}

function Review({ payload }: { payload: AgentProfileConfirmPayload }) {
  const [result, setResult] = useState('')
  return (
    <div className="@container">
      <AgentProfileConfirmPrompt
        payload={payload}
        onConfirm={(draft) => setResult(draft ? `allow: ${JSON.stringify(draft)}` : 'allow')}
        onReject={(feedback) => setResult(feedback ? `deny: ${feedback}` : 'deny')}
      />
      {result ? <output className="mx-3 block text-xs text-muted-foreground">{result}</output> : null}
    </div>
  )
}

const meta: Meta<typeof Review> = {
  title: 'Tool UI/SuperOne MCP/Agent Profile/Confirm',
  component: Review,
  decorators: [(Story) => <div style={{ maxWidth: 640 }}><Story /></div>],
  parameters: { layout: 'padded' },
}
export default meta
type Story = StoryObj<typeof meta>

/** Every field is editable; approving shows the draft the host would save. */
export const Create: Story = { args: { payload: CREATE } }
/** Every runtime field left to the user's default; this ACP agent lists no session modes. */
export const CreateWithDefaults: Story = { args: { payload: CREATE_DEFAULTS } }
export const CreateLongContent: Story = { args: { payload: CREATE_LONG } }
export const CreateInvalid: Story = { args: { payload: CREATE_INVALID } }
export const EveryHarness: Story = {
  args: { payload: CREATE },
  render: () => <div className="space-y-3">{EVERY_HARNESS.map((payload, index) => <Review key={index} payload={payload} />)}</div>,
}
export const UpdateDiff: Story = { args: { payload: UPDATE } }
export const UpdateLongContent: Story = { args: { payload: UPDATE_LONG } }
export const Delete: Story = { args: { payload: DELETE } }
export const Narrow: Story = { args: { payload: UPDATE_LONG }, decorators: [(Story) => <div style={{ width: 300 }}><Story /></div>] }
export const NarrowCreate: Story = { args: { payload: CREATE }, decorators: [(Story) => <div style={{ width: 300 }}><Story /></div>] }
export const Dark: Story = { args: { payload: CREATE }, globals: { theme: 'dark' } }
export const DarkDelete: Story = { args: { payload: DELETE }, globals: { theme: 'dark' } }
export const Chinese: Story = { args: { payload: UPDATE }, globals: { locale: 'zh' } }
export const ChineseCreate: Story = { args: { payload: CREATE }, globals: { locale: 'zh' } }
