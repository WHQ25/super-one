import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import type { AgentProfileConfirmPayload } from '@superone/shared/agent-types'
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

const CREATE: AgentProfileConfirmPayload = {
  operation: 'create',
  profiles: [{
    harnessId: 'claude',
    name: 'Reviewer',
    description: 'Reviews diffs for correctness and security without editing files. Delegate code review here.',
    instructions: 'Never edit files. Report findings ranked by severity with file:line.',
    model: 'opus',
    modelName: 'Opus 5.5',
    effort: 'xhigh',
    options: { ultracode: 'on' },
  }],
}

const CREATE_DEFAULTS: AgentProfileConfirmPayload = {
  operation: 'create',
  profiles: [{
    harnessId: 'acp',
    acpAgentId: 'grok-build',
    name: 'Grok Scout',
    description: 'Fast codebase exploration and summaries.',
    unsupported: ['mode'],
  }],
}

/** One profile per harness: each card shows only that harness's own options. */
const EVERY_HARNESS: AgentProfileConfirmPayload[] = [
  CREATE,
  { operation: 'create', profiles: [{ harnessId: 'codex', name: 'Speedy', description: 'Quick fixes.', model: 'gpt-5.6', effort: 'medium', options: { fastMode: 'on' } }] },
  { operation: 'create', profiles: [{ harnessId: 'acp', acpAgentId: 'grok-build', name: 'Grok Scout', description: 'Large-context exploration.', model: 'grok-4', modelName: 'Grok 4', effort: 'high', options: { contextWindow: '1M' }, unsupported: ['mode'] }] },
  { operation: 'create', profiles: [{ harnessId: 'opencode', name: 'Planner', description: 'Plans before building.', model: 'anthropic/claude-sonnet-5-5', options: { agent: 'Plan' } }] },
  { operation: 'create', profiles: [{ harnessId: 'cursor', name: 'Cursor Fast', description: 'Small edits on the fast tier.', model: 'claude-opus-5-5', options: { modelParams: 'Fast: On, Context: 1M' } }] },
  { operation: 'create', profiles: [{ harnessId: 'dsh', name: 'DeepSeek Minimal', description: 'Lean tool set.', model: 'deepseek-v4-pro', options: { agentPreset: 'Minimal' } }] },
]

const UPDATE: AgentProfileConfirmPayload = {
  operation: 'update',
  profiles: [{ ...CREATE.profiles[0]!, id: 'claude-reviewer', effort: 'max' }],
  changes: [
    { field: 'model', from: 'sonnet', to: 'opus' },
    { field: 'effort', from: 'high', to: 'max' },
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
        onConfirm={() => setResult('allow')}
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

export const Create: Story = { args: { payload: CREATE } }
/** Every runtime field left to the user's default; this ACP agent lists no session modes. */
export const CreateWithDefaults: Story = { args: { payload: CREATE_DEFAULTS } }
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
