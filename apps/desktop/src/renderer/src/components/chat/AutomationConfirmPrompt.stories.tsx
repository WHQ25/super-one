import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ReactNode } from 'react'
import type { AutomationConfirmPayload } from '@superone/shared/agent-types'
import { AutomationConfirmPrompt, type AutomationConfirmResult } from './AutomationConfirmPrompt'

/**
 * Structured HITL for automation create / update / delete.
 * Create / update use the collab confirm strip (model · effort · permission · sandbox).
 * Title: Automation / ConfirmPrompt
 */

function StoryShell({ children, width = 560 }: { children: ReactNode; width?: number }) {
  return (
    <div className="@container space-y-4" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  )
}

function Note({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>
}

function Harness({ payload }: { payload: AutomationConfirmPayload }) {
  const [result, setResult] = useState<string | null>(null)
  return (
    <div>
      <AutomationConfirmPrompt
        payload={payload}
        onConfirm={(result?: AutomationConfirmResult) =>
          setResult(result ? `allow: ${JSON.stringify(result)}` : 'allow')
        }
        onReject={(feedback) => setResult(feedback ? `deny: ${feedback}` : 'deny')}
      />
      {result ? (
        <pre className="mx-3 mt-1 rounded bg-muted/40 p-2 text-[10px] break-all">{result}</pre>
      ) : null}
    </div>
  )
}

const CREATE: AutomationConfirmPayload = {
  operation: 'create',
  items: [
    {
      name: 'Daily Review',
      scheduleSummary: '每个工作日上午 9 点',
      agentType: 'claude',
      agent: {
        type: 'claude',
        permissionMode: 'bypassPermissions',
        sandboxMode: 'off',
        model: 'claude-sonnet-4',
        effort: 'high',
      },
      enabled: true,
      promptPreview: 'Review recent commits and summarize blockers for standup',
      prompt: [
        '## Daily standup prep',
        '',
        '1. Review recent commits since yesterday',
        '2. Summarize **blockers** and open PRs',
        '3. Suggest a short agenda:',
        '',
        '```md',
        '- Wins',
        '- Risks',
        '- Asks',
        '```',
      ].join('\n'),
    },
  ],
}

const CREATE_CODEX: AutomationConfirmPayload = {
  operation: 'create',
  items: [
    {
      name: 'Codex nightly',
      scheduleSummary: 'Every night at 2:00 AM',
      agent: {
        type: 'codex',
        permissionMode: 'bypassPermissions',
        permissionPreset: 'full-access',
        model: 'gpt-5.4',
        effort: 'high',
      },
      enabled: true,
      promptPreview: 'Run the flaky suite and open a report issue',
      prompt: 'Run the flaky suite overnight and open a report issue if failures regress.',
    },
  ],
}

const UPDATE_TOGGLE: AutomationConfirmPayload = {
  operation: 'update',
  items: [
    {
      id: 'auto-aaaaaaaa-1111-4000-8000-aaaaaaaaaaaa',
      name: 'Daily Review',
      scheduleSummary: '每个工作日上午 9 点',
      agent: {
        type: 'claude',
        permissionMode: 'bypassPermissions',
        sandboxMode: 'off',
      },
      enabled: false,
    },
  ],
  changes: [
    { field: 'enabled', from: 'on', to: 'off' },
  ],
}

const UPDATE_PERMISSION: AutomationConfirmPayload = {
  operation: 'update',
  items: [
    {
      id: 'auto-aaaaaaaa-1111-4000-8000-aaaaaaaaaaaa',
      name: 'Daily Review',
      scheduleSummary: '每个工作日上午 9 点',
      agent: {
        type: 'claude',
        permissionMode: 'bypassPermissions',
        sandboxMode: 'off',
        model: 'claude-sonnet-4',
        effort: 'high',
      },
      enabled: true,
      promptPreview: 'Review recent commits and summarize blockers for standup',
      prompt: 'Review recent commits and summarize blockers for standup',
    },
  ],
  // changes kept for icon heuristic only; UI shows latest snapshot, not from→to
  changes: [
    {
      field: 'agent',
      to: 'claude · bypassPermissions · sandbox off',
      agentTo: {
        type: 'claude',
        permissionMode: 'bypassPermissions',
        sandboxMode: 'off',
        model: 'claude-sonnet-4',
      },
    },
  ],
}

const UPDATE_MULTI: AutomationConfirmPayload = {
  operation: 'update',
  items: [
    {
      id: 'auto-aaaaaaaa-1111-4000-8000-aaaaaaaaaaaa',
      name: 'Daily Review (renamed)',
      scheduleSummary: '每天上午 10 点',
      agent: {
        type: 'codex',
        permissionMode: 'bypassPermissions',
        permissionPreset: 'full-access',
        model: 'gpt-5.6-sol',
        effort: 'xhigh',
      },
      enabled: true,
      promptPreview: 'Draft a weekly changelog from merged PRs',
      prompt: [
        'Draft a weekly changelog from merged PRs.',
        '',
        '- Group by area',
        '- Call out breaking changes',
      ].join('\n'),
    },
  ],
  changes: [
    { field: 'name', to: 'Daily Review (renamed)' },
    { field: 'schedule', to: '每天上午 10 点' },
    {
      field: 'agent',
      agentTo: {
        type: 'codex',
        permissionMode: 'bypassPermissions',
        permissionPreset: 'full-access',
        model: 'gpt-5.6-sol',
        effort: 'xhigh',
      },
    },
    { field: 'prompt', to: 'Draft a weekly changelog from merged PRs' },
  ],
}

const DELETE: AutomationConfirmPayload = {
  operation: 'delete',
  items: [
    {
      id: 'auto-aaaaaaaa-1111-4000-8000-aaaaaaaaaaaa',
      name: 'Daily Review',
      scheduleSummary: '每个工作日上午 9 点',
      enabled: true,
    },
    {
      id: 'auto-bbbbbbbb-2222-4000-8000-bbbbbbbbbbbb',
      name: 'Nightly test suite',
      scheduleSummary: 'Every night at 2:00 AM',
      enabled: false,
    },
  ],
}

const meta: Meta<typeof Harness> = {
  title: 'Automation/ConfirmPrompt',
  component: Harness,
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj<typeof Harness>

export const Gallery: Story = {
  name: 'Gallery',
  render: () => (
    <StoryShell width={580}>
      <Note>
        Create / update show the resulting snapshot only (no old→new diff), plus the
        collab toolbar for model · effort · permission · sandbox. Prompt is Markdown —
        click to expand (max-height + scroll). Delete stays read-only.
      </Note>
      <Section title="create · Claude (collab strip)">
        <Harness payload={CREATE} />
      </Section>
      <Section title="create · Codex">
        <Harness payload={CREATE_CODEX} />
      </Section>
      <Section title="update · toggle (latest only)">
        <Harness payload={UPDATE_TOGGLE} />
      </Section>
      <Section title="update · agent (latest only)">
        <Harness payload={UPDATE_PERMISSION} />
      </Section>
      <Section title="update · multi field (latest only)">
        <Harness payload={UPDATE_MULTI} />
      </Section>
      <Section title="delete">
        <Harness payload={DELETE} />
      </Section>
    </StoryShell>
  ),
}

export const Create: Story = {
  name: 'Create',
  args: { payload: CREATE },
}

export const CreateCodex: Story = {
  name: 'Create · Codex',
  args: { payload: CREATE_CODEX },
}

export const UpdatePermission: Story = {
  name: 'Update · permission',
  args: { payload: UPDATE_PERMISSION },
}

export const UpdateToggle: Story = {
  name: 'Update · toggle off',
  args: { payload: UPDATE_TOGGLE },
}

export const Delete: Story = {
  name: 'Delete',
  args: { payload: DELETE },
}
