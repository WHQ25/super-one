import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, type ReactNode } from 'react'
import { PermissionPrompt } from './PermissionPrompt'
import { useChatStore } from '@/stores/chat'
import type { PermissionRequest } from '@superone/shared/agent-types'

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
  title: 'Tool UI/General/Permission Prompt',
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
        allowAlwaysAllow: false,
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
        allowAlwaysAllow: false,
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
        allowAlwaysAllow: false,
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
        allowAlwaysAllow: false,
        serverName: 'sentry',
        riskLevel: 'medium',
      }} />
      <Story />
    </>
  )],
}

/** Host confirm for an agent terminal command: Allow / Deny, plus the "always allow in this project" toggle row. */
export const TerminalCommand: Story = {
  decorators: [(Story) => (
    <>
      <SeedPermission request={{
        requestId: 'p-terminal',
        toolName: 'mcp__superone__terminal_tabs',
        toolUseId: 'tu-terminal',
        input: {
          action: 'run',
          command: 'bun run storybook --ci',
          cwd: '/Users/me/Developer/super-one/apps/desktop',
          rule: 'bun run storybook --ci:*',
          description: 'Start Storybook to check the new terminal stories',
        },
        allowAlwaysAllow: true,
        supportsAlwaysPersist: true,
        requestKind: 'terminal_command_confirm',
        serverName: 'superone',
        message: 'Run `bun run storybook --ci` in a terminal tab?',
      }} />
      <Story />
    </>
  )],
}

/** Closing a user tab: same kind, but no always-allow, so no toggle row. */
export const TerminalCloseUserTab: Story = {
  decorators: [(Story) => (
    <>
      <SeedPermission request={{
        requestId: 'p-terminal-close',
        toolName: 'mcp__superone__terminal_tabs',
        toolUseId: 'tu-terminal-close',
        input: { action: 'close', command: 'node', cwd: '/Users/me/Developer/super-one', tab: 'dev server' },
        allowAlwaysAllow: false,
        requestKind: 'terminal_command_confirm',
        serverName: 'superone',
        message: 'Close the terminal tab “dev server”? This kills whatever is running in it.',
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
        allowAlwaysAllow: false,
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
        allowAlwaysAllow: false,
        suggestions: [
          { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'gh pr:*' }], destination: 'session' },
          { type: 'setMode', mode: 'acceptEdits' },
          { type: 'setMode', mode: 'auto' },
        ],
        riskLevel: 'low',
      }} />
      <Story />
    </>
  )],
}

/**
 * SDK `defaultToNo` hint (0.3.268+): Deny takes initial focus and the ⏎ hint
 * moves off Allow — approving needs a deliberate click or arrow + Enter.
 */
export const DefaultToNo: Story = {
  decorators: [(Story) => (
    <>
      <SeedPermission request={{
        requestId: 'p-default-no',
        toolName: 'Bash',
        toolUseId: 'tu-default-no',
        input: { command: 'git push --force origin main' },
        allowAlwaysAllow: false,
        defaultToNo: true,
        riskLevel: 'high',
        message: 'Run shell command',
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
