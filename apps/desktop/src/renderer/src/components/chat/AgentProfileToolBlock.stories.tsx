import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { encode as toonEncode } from '@toon-format/toon'
import { AgentProfileToolBlock } from './AgentProfileToolBlock'

/**
 * agent_profile_* chat rows (shared with the phone through chat-view). Results
 * mirror `agent-profile-tools.ts`: the list is a TOON table, writes are JSON.
 */

const LIST_RESULT = toonEncode({
  status: 'ok',
  count: 3,
  profiles: [
    { id: 'claude-base', name: 'Claude (Base)', harness: 'claude', base: true, available: true, description: "Claude with the user's default configuration.", model: '', effort: '', fastMode: null, context: '' },
    { id: 'codex-base', name: 'Codex (Base)', harness: 'codex', base: true, available: true, description: "Codex with the user's default configuration.", model: '', effort: '', fastMode: null, context: '' },
    { id: 'claude-reviewer', name: 'Reviewer', harness: 'claude', base: false, available: true, description: 'Reviews diffs for correctness and security without editing files. Delegate code review here, especially for payment…', model: 'opus', effort: 'xhigh', fastMode: null, context: '1m' },
  ],
})

const DETAIL_RESULT = JSON.stringify({
  status: 'ok',
  profile: { id: 'claude-reviewer', name: 'Reviewer', harnessId: 'claude', base: false, available: true, description: 'Reviews diffs without editing files.', instructions: 'Never edit files.', runtime: { model: 'opus', effort: 'xhigh', context: '1m' } },
  launchDefaults: { model: 'opus[1m]', effort: 'xhigh', permissionMode: 'default' },
  options: { models: [{ id: 'opus', name: 'Opus 5.5', efforts: ['low', 'high', 'xhigh', 'max'], fastMode: false, contexts: ['default', '1m'] }] },
})

const CREATE_RESULT = JSON.stringify({
  status: 'ok',
  action: 'create',
  profile: { id: 'claude-1f2e', name: 'Reviewer', harnessId: 'claude', description: 'Reviews diffs without editing files.', hasInstructions: true, runtime: { model: 'opus', effort: 'xhigh', context: '1m' } },
  next: 'Delegate with session_collab_request({ agentId: "claude-1f2e" }); the user can @-mention it as Reviewer.',
})

const UPDATE_RESULT = JSON.stringify({
  status: 'ok',
  action: 'update',
  profile: { id: 'claude-1f2e', name: 'Reviewer', harnessId: 'claude', description: 'Reviews diffs without editing files.', hasInstructions: true, runtime: { model: 'opus', effort: 'max' } },
  changed: ['effort', 'context'],
})

const REJECTED = JSON.stringify({ status: 'rejected', message: 'The user did not approve this change. Do not retry on your own; wait for the user.', feedback: 'Keep Sonnet' })
const INVALID = JSON.stringify({ status: 'error', message: 'runtime.fastMode is not supported by Claude model "opus".' })
const DELETE_RESULT = JSON.stringify({ status: 'ok', deleted: [{ id: 'claude-1f2e', name: 'Reviewer' }, { id: 'codex-9a', name: 'Speedy' }] })
const DELETE_PARTIAL = JSON.stringify({ status: 'partial', deleted: [{ id: 'claude-1f2e', name: 'Reviewer' }], failed: [{ id: 'codex-9a', name: 'Speedy', error: 'database is locked' }] })
const DELETE_BUILT_IN = JSON.stringify({ status: 'not_found', deleted: [], builtIn: ['claude-base'], message: 'Built-in <harness>-base agents cannot be deleted.' })

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="space-y-1">{children}</div>
    </section>
  )
}

function Gallery() {
  return (
    <div className="@container space-y-4">
      <Section title="agent_profile_list">
        <AgentProfileToolBlock toolName="agent_profile_list" params={{}} isStreaming />
        <AgentProfileToolBlock toolName="agent_profile_list" params={{}} result={LIST_RESULT} />
        <AgentProfileToolBlock toolName="agent_profile_list" params={{ id: 'claude-reviewer' }} result={DETAIL_RESULT} />
        <AgentProfileToolBlock toolName="agent_profile_list" params={{}} result={toonEncode({ status: 'ok', count: 0, profiles: [] })} />
        <AgentProfileToolBlock toolName="agent_profile_list" params={{ id: 'nope' }} isError result={JSON.stringify({ status: 'error', message: 'Agent profile not found: nope. Call agent_profile_list without id to discover ids.' })} />
      </Section>
      <Section title="agent_profile_apply">
        <AgentProfileToolBlock toolName="agent_profile_apply" params={{ action: 'create', name: 'Reviewer' }} isStreaming />
        <AgentProfileToolBlock toolName="agent_profile_apply" params={{ action: 'create', name: 'Reviewer' }} result={CREATE_RESULT} />
        <AgentProfileToolBlock toolName="agent_profile_apply" params={{ action: 'update', id: 'claude-1f2e' }} result={UPDATE_RESULT} />
        <AgentProfileToolBlock toolName="agent_profile_apply" params={{ action: 'update', id: 'claude-1f2e', name: 'Reviewer' }} result={REJECTED} />
        <AgentProfileToolBlock toolName="agent_profile_apply" params={{ action: 'create', name: 'Fast' }} isError result={INVALID} />
        <AgentProfileToolBlock toolName="agent_profile_apply" params={{ action: 'create', name: 'Reviewer' }} isDenied result="Permission denied" />
      </Section>
      <Section title="agent_profile_delete">
        <AgentProfileToolBlock toolName="agent_profile_delete" params={{ ids: ['a', 'b'] }} isStreaming />
        <AgentProfileToolBlock toolName="agent_profile_delete" params={{ ids: ['a', 'b'] }} result={DELETE_RESULT} />
        <AgentProfileToolBlock toolName="agent_profile_delete" params={{ ids: ['a', 'b'] }} result={DELETE_PARTIAL} />
        <AgentProfileToolBlock toolName="agent_profile_delete" params={{ ids: ['claude-base'] }} result={DELETE_BUILT_IN} />
        <AgentProfileToolBlock toolName="agent_profile_delete" params={{ ids: ['a'] }} result={JSON.stringify({ status: 'cancelled', message: 'Agent profile delete cancelled' })} />
      </Section>
      <Section title="Nested in a subagent (allowExpand=false)">
        <AgentProfileToolBlock toolName="agent_profile_list" params={{}} result={LIST_RESULT} allowExpand={false} />
        <AgentProfileToolBlock toolName="agent_profile_apply" params={{ action: 'create', name: 'Reviewer' }} result={CREATE_RESULT} allowExpand={false} />
      </Section>
    </div>
  )
}

const meta: Meta<typeof Gallery> = {
  title: 'Tool UI/SuperOne MCP/Agent Profile/Tool Rows',
  component: Gallery,
  decorators: [(Story) => <div style={{ maxWidth: 640 }}><Story /></div>],
  parameters: { layout: 'padded' },
}
export default meta
type Story = StoryObj<typeof meta>

export const AllStates: Story = {}
export const Narrow: Story = { decorators: [(Story) => <div style={{ width: 300 }}><Story /></div>] }
export const Dark: Story = { globals: { theme: 'dark' } }
export const Chinese: Story = { globals: { locale: 'zh' } }
