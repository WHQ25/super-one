import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, type ReactNode } from 'react'
import { PlanApprovalPrompt } from './PlanApprovalPrompt'
import { useChatStore } from '@/stores/chat'
import type { PlanApprovalRequest } from '../../../../shared/agent-types'

function StoryShell({ children, width = 720 }: { children: ReactNode; width?: number }) {
  return (
    <div className="@container" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

function SeedPlanApproval({ request }: { request: PlanApprovalRequest | null }) {
  useEffect(() => {
    const apply = (): void => {
      useChatStore.setState((s) => {
        const projectId = s.activeProject
        if (!projectId) return s
        const project = s.projectSessions[projectId]
        if (!project) return s
        const sid = project._activeSessionId
        if (!sid) return s
        const session = project._sessions[sid]
        if (!session) return s
        return {
          projectSessions: {
            ...s.projectSessions,
            [projectId]: {
              ...project,
              _sessions: {
                ...project._sessions,
                [sid]: { ...session, pendingPlanApproval: request },
              },
            },
          },
        }
      })
    }
    apply()
    const t = setTimeout(apply, 0)
    return () => clearTimeout(t)
  }, [request])
  return null
}

const SHORT_PLAN = [
  '## Plan',
  '',
  '1. Audit `Session.send()` callers.',
  '2. Move ownership lock check inside `Session.send()`.',
  '3. Delete duplicated lock checks in IPC handlers.',
].join('\n')

const LONG_PLAN = [
  '# Plan: per-session ownership',
  '',
  '> Goal: move session ownership state out of `RemoteControlService` and onto each `Session` instance.',
  '',
  '## Steps',
  '',
  '1. Add `owner` and `subscribers` fields to the `Session` class.',
  '2. Move `claim` / `release` / `subscribe` / `unsubscribe` onto `Session`.',
  '3. Centralize disconnect cleanup in `device-registry.ts`.',
  '4. Add integration tests covering the lock check.',
  '',
  '## Risk',
  '',
  '- Touching the relay protocol affects all mobile clients.',
  '- Mitigation: gate behind alpha tag for one cycle.',
].join('\n')

const meta: Meta<typeof PlanApprovalPrompt> = {
  title: 'Codex/PlanApprovalPrompt',
  component: PlanApprovalPrompt,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <StoryShell width={820}><Story /></StoryShell>],
}

export default meta
type Story = StoryObj<typeof PlanApprovalPrompt>

export const ShortPlan: Story = {
  decorators: [(Story) => (
    <>
      <SeedPlanApproval request={{
        requestId: 'pa-short',
        planContent: SHORT_PLAN,
        planFilePath: '/tmp/super-one-plans/short-plan.md',
        allowedPrompts: [
          { tool: 'Bash', prompt: 'run tests' },
          { tool: 'Bash', prompt: 'install dependencies' },
        ],
      }} />
      <Story />
    </>
  )],
}

export const LongPlan: Story = {
  decorators: [(Story) => (
    <>
      <SeedPlanApproval request={{
        requestId: 'pa-long',
        planContent: LONG_PLAN,
        planFilePath: '/tmp/super-one-plans/per-session-ownership.md',
        allowedPrompts: [],
      }} />
      <Story />
    </>
  )],
}

export const NoPending: Story = {
  decorators: [(Story) => (
    <>
      <SeedPlanApproval request={null} />
      <Story />
    </>
  )],
}
