import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, type ReactNode } from 'react'
import { PermissionPrompt } from './PermissionPrompt'
import { useChatStore } from '@/stores/chat'
import type { PermissionRequest } from '../../../../shared/agent-types'

function StoryShell({ children, width = 720 }: { children: ReactNode; width?: number }) {
  return (
    <div className="@container" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

function SeedPermission({ request }: { request: PermissionRequest | null }) {
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
                [sid]: {
                  ...session,
                  pendingPermissions: request ? [request] : [],
                },
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

const meta: Meta<typeof PermissionPrompt> = {
  title: 'Common/PermissionPrompt',
  component: PermissionPrompt,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <StoryShell width={820}><Story /></StoryShell>],
}

export default meta
type Story = StoryObj<typeof PermissionPrompt>

const EDIT_DIFF = [
  '@@ -42,7 +42,9 @@',
  ' export class Session {',
  '   owner: Owner = { kind: "local" }',
  '+  subscribers = new Set<string>()',
  ' ',
  '-  send(text: string) {',
  '+  send(text: string, origin: Origin) {',
  '     this.transport.send(text)',
  '   }',
].join('\n')

export const BashCommand: Story = {
  decorators: [(Story) => (
    <>
      <SeedPermission request={{
        requestId: 'p-bash',
        toolName: 'Bash',
        toolUseId: 'tu-bash',
        input: { command: 'rm -rf node_modules && bun install' },
        allowAlwaysAllow: true,
        riskLevel: 'medium',
        message: 'Run shell command',
      }} />
      <Story />
    </>
  )],
}

export const EditWithDiff: Story = {
  decorators: [(Story) => (
    <>
      <SeedPermission request={{
        requestId: 'p-edit',
        toolName: 'Edit',
        toolUseId: 'tu-edit',
        input: {
          file_path: '/Users/me/projects/super-one/src/main/session/session.ts',
          old_string: 'send(text: string)',
          new_string: 'send(text: string, origin: Origin)',
        },
        allowAlwaysAllow: true,
        toolDiff: EDIT_DIFF,
        toolLineDelta: { added: 4, removed: 1 },
        riskLevel: 'low',
      }} />
      <Story />
    </>
  )],
}

export const WriteFile: Story = {
  decorators: [(Story) => (
    <>
      <SeedPermission request={{
        requestId: 'p-write',
        toolName: 'Write',
        toolUseId: 'tu-write',
        input: {
          file_path: '/Users/me/projects/super-one/src/shared/new-feature.ts',
          content: 'export const FOO = "bar"\n',
        },
        allowAlwaysAllow: true,
        toolLineDelta: { added: 1, removed: 0 },
        riskLevel: 'low',
      }} />
      <Story />
    </>
  )],
}

export const McpTool: Story = {
  decorators: [(Story) => (
    <>
      <SeedPermission request={{
        requestId: 'p-mcp',
        toolName: 'mcp__sentry__create_issue',
        toolUseId: 'tu-mcp',
        input: { title: 'Reproducer for chat regression', project: 'super-one' },
        allowAlwaysAllow: true,
        serverName: 'sentry',
        riskLevel: 'medium',
      }} />
      <Story />
    </>
  )],
}

export const SandboxNetworkAccess: Story = {
  decorators: [(Story) => (
    <>
      <SeedPermission request={{
        requestId: 'p-sandbox',
        toolName: 'SandboxNetworkAccess',
        toolUseId: 'tu-sandbox',
        input: { host: 'api.openai.com' },
        allowAlwaysAllow: true,
        riskLevel: 'high',
        message: 'Outbound network from sandbox',
      }} />
      <Story />
    </>
  )],
}

export const WithSuggestions: Story = {
  decorators: [(Story) => (
    <>
      <SeedPermission request={{
        requestId: 'p-sugg',
        toolName: 'Bash',
        toolUseId: 'tu-sugg',
        input: { command: 'gh pr create --title "..."' },
        allowAlwaysAllow: true,
        suggestions: [
          { kind: 'add_rule', label: 'Allow `gh pr *` going forward', detail: 'permissions.allow += Bash(gh pr:*)' },
          { kind: 'set_mode', label: 'Switch to acceptEdits', detail: 'Bypass per-tool prompts for this session.' },
        ],
        riskLevel: 'low',
      }} />
      <Story />
    </>
  )],
}

export const WithBlockedPath: Story = {
  decorators: [(Story) => (
    <>
      <SeedPermission request={{
        requestId: 'p-blocked',
        toolName: 'Read',
        toolUseId: 'tu-blocked',
        input: { file_path: '/Users/me/secrets/.env' },
        allowAlwaysAllow: false,
        blockedPath: '/Users/me/secrets',
        decisionReason: 'Path is outside the project working tree.',
        riskLevel: 'high',
      }} />
      <Story />
    </>
  )],
}

export const NoPending: Story = {
  decorators: [(Story) => (
    <>
      <SeedPermission request={null} />
      <Story />
    </>
  )],
}
