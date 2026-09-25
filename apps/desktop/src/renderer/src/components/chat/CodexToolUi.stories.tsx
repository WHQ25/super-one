import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ReactNode } from 'react'
import type {
  ChatMessage,
  CodexCollabToolCallItem,
  CodexThreadItem,
  ImageGenerationItem,
} from '@superone/shared/agent-types'
import type { MiniAppEntry } from '@superone/shared/miniapp-types'
import { useAppStore } from '@/stores/app'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { useMiniAppStore } from '@/stores/miniapp'
import { CodexCollabBlock } from './CodexCollabBlock'
import { CodexImageGenerationBlock } from './CodexImageGenerationBlock'
import { CodexTurnView } from './CodexTurnView'
import { renderCodexItem } from './codex-item-renderer'

const STORY_APP: MiniAppEntry = {
  id: 'project-tools',
  installDir: '/Users/me/.superone/apps/project-tools',
  manifest: {
    appId: 'project-tools',
    name: 'Project Tools',
    main: 'node.js',
    version: '1.0.0',
    tools: [
      {
        name: 'find_files',
        description: 'Find files in a project.',
        displayName: 'Find files',
        runningText: 'Finding files',
        inputSummaryField: 'query',
        showResult: true,
        groupable: true,
        inputSchema: {},
      },
      {
        name: 'inspect_file',
        description: 'Inspect a project file.',
        displayName: 'Inspect file',
        runningText: 'Inspecting file',
        inputSummaryField: 'path',
        showResult: true,
        groupable: true,
        inputSchema: {},
      },
    ],
  },
}

function StoryShell({ children }: { children: ReactNode }) {
  return <div className="@container mx-auto w-full max-w-180 space-y-2">{children}</div>
}

function SeedCodexStory({ children }: { children: ReactNode }) {
  useState(() => {
    const project = createDefaultProjectState()
    const session = {
      ...createDefaultPerSessionState(),
      selectedCodexCollaborationMode: 'default' as const,
    }
    useAppStore.setState({ detailChatMode: true })
    useMiniAppStore.setState({ apps: [STORY_APP], loaded: true })
    useChatStore.setState({
      activeProject: '/storybook/codex-tool-ui',
      projectSessions: {
        '/storybook/codex-tool-ui': {
          ...project,
          _activeSessionId: 'story-session',
          _sessions: { 'story-session': session },
        },
      },
    })
    return null
  })
  return <>{children}</>
}

function StoryLabel({ children }: { children: ReactNode }) {
  return <div className="pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{children}</div>
}

function ItemPreview({ item, isStreaming = false }: { item: CodexThreadItem; isStreaming?: boolean }) {
  return <>{renderCodexItem(item, 0, isStreaming)}</>
}

function turnMessage(id: string, items: CodexThreadItem[], streaming = false): ChatMessage {
  return {
    id,
    role: 'assistant',
    status: streaming ? 'streaming' : 'complete',
    content: [],
    createdAt: '2026-08-18T00:00:00.000Z',
    providerId: 'codex',
    metadata: {
      codex: {
        threadId: 'storybook-thread',
        usage: null,
        items,
      },
    },
  }
}

const meta: Meta = {
  title: 'Tool UI/Codex/Gallery',
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: '真实 Codex item 路由与组合组件的视觉回归场景，补充单项命令 stories 未覆盖的分组、协作及失败状态。',
      },
    },
  },
  decorators: [
    (Story) => (
      <SeedCodexStory>
        <StoryShell>
          <Story />
        </StoryShell>
      </SeedCodexStory>
    ),
  ],
}

export default meta
type Story = StoryObj

export const NativeImageFailure: Story = {
  render: () => (
    <CodexImageGenerationBlock
      item={
        {
          id: 'image-failed',
          type: 'image_generation',
          status: 'failed',
          revisedPrompt: 'A quiet workspace at dusk',
        } satisfies ImageGenerationItem
      }
    />
  ),
}

export const CommandGroupRunning: Story = {
  render: () => {
    const message = turnMessage(
      'command-group',
      [
        {
          id: 'read-settings',
          type: 'command_execution',
          command: "sed -n '1,220p' src/settings.ts",
          aggregatedOutput: "export const settings = { theme: 'system' }\n",
          exitCode: 0,
          status: 'completed',
          commandActions: [{ type: 'read', path: 'src/settings.ts' }],
        },
        {
          id: 'search-theme',
          type: 'command_execution',
          command: 'rg "theme" src',
          aggregatedOutput: "src/settings.ts:1:export const settings = { theme: 'system' }\n",
          status: 'in_progress',
          commandActions: [{ type: 'search', query: 'theme', path: 'src' }],
        },
      ],
      true,
    )
    return <CodexTurnView message={message} isStreaming isLastAssistant />
  },
}

export const MiniAppToolGroupRunning: Story = {
  render: () => {
    const message = turnMessage(
      'app-group',
      [
        {
          id: 'find-files',
          type: 'mcp_tool_call',
          server: 'superone',
          tool: 'miniapp_call',
          arguments: {
            appId: 'project-tools',
            tool: 'find_files',
            arguments: { query: 'tool ui' },
          },
          result: {
            content: [{ type: 'text', text: '{"files":["tool-row.tsx"]}' }],
            structuredContent: {},
          },
          status: 'completed',
        },
        {
          id: 'inspect-file',
          type: 'mcp_tool_call',
          server: 'superone',
          tool: 'miniapp_call',
          arguments: {
            appId: 'project-tools',
            tool: 'inspect_file',
            arguments: { path: 'tool-row.tsx' },
          },
          status: 'in_progress',
        },
      ],
      true,
    )
    return <CodexTurnView message={message} isStreaming isLastAssistant />
  },
}

export const CollaborationRows: Story = {
  render: () => (
    <>
      <StoryLabel>Waiting</StoryLabel>
      <ItemPreview
        isStreaming
        item={{
          id: 'wait-reviewer',
          type: 'collab_tool_call',
          tool: 'wait',
          status: 'in_progress',
          receiverThreadIds: ['reviewer-thread'],
          agentsStates: {
            'reviewer-thread': { status: 'running', nickname: 'Reviewer' },
          },
        }}
      />
      <StoryLabel>Follow-up sent</StoryLabel>
      <ItemPreview
        item={{
          id: 'send-follow-up',
          type: 'collab_tool_call',
          tool: 'sendInput',
          status: 'completed',
          receiverThreadIds: ['reviewer-thread'],
          agentsStates: {
            'reviewer-thread': { status: 'running', nickname: 'Reviewer' },
          },
          prompt: 'Please verify the failed-state colors as well.',
        }}
      />
      <StoryLabel>Follow-up failed</StoryLabel>
      <ItemPreview
        item={{
          id: 'send-follow-up-failed',
          type: 'collab_tool_call',
          tool: 'sendInput',
          status: 'failed',
          receiverThreadIds: ['reviewer-thread'],
          agentsStates: {
            'reviewer-thread': { status: 'errored', nickname: 'Reviewer' },
          },
          prompt: 'Please retry the visual review.',
        }}
      />
    </>
  ),
}

const SUBAGENT_ITEMS: CodexCollabToolCallItem[] = [
  {
    id: 'spawn-reviewer',
    type: 'collab_tool_call',
    tool: 'spawnAgent',
    status: 'completed',
    receiverThreadIds: ['reviewer-thread'],
    prompt: 'Review the Tool UI refactor and report visual inconsistencies.',
    agentsStates: {
      'reviewer-thread': {
        status: 'completed',
        nickname: 'Reviewer',
        role: 'UI review',
        tokens: { input: 3400, output: 680 },
      },
    },
    childItems: {
      'reviewer-thread': [
        {
          id: 'child-read',
          type: 'command_execution',
          command: "sed -n '1,240p' tool-row.tsx",
          aggregatedOutput: '',
          exitCode: 0,
          status: 'completed',
          commandActions: [{ type: 'read', path: 'tool-row.tsx' }],
        },
        {
          id: 'child-edit',
          type: 'file_change',
          changes: [{ path: 'CodexTurnView.tsx', kind: 'update' }],
          status: 'completed',
        },
        {
          id: 'child-mcp',
          type: 'mcp_tool_call',
          server: 'storybook',
          tool: 'capture_ui',
          arguments: { story: 'Tool UI Gallery' },
          status: 'failed',
          error: { message: 'Screenshot comparison failed' },
        },
        {
          id: 'child-search',
          type: 'web_search',
          query: 'accessible tool status patterns',
          status: 'completed',
        },
        {
          id: 'child-output',
          type: 'agent_message',
          text: 'The shared row grammar is consistent; one screenshot comparison needs review.',
        },
      ],
    },
  },
]

export const SubagentMiniTools: Story = {
  render: () => <CodexCollabBlock items={SUBAGENT_ITEMS} isStreaming={false} defaultExpanded />,
}

export const FailedAdapterRows: Story = {
  render: () => (
    <>
      <StoryLabel>MCP failure</StoryLabel>
      <ItemPreview
        item={{
          id: 'mcp-failed',
          type: 'mcp_tool_call',
          server: 'github',
          tool: 'get_pull_request',
          arguments: { owner: 'superone', repo: 'desktop', number: 42 },
          status: 'failed',
          error: { message: 'Pull request was not found' },
        }}
      />
      <StoryLabel>MCP auth-rejected</StoryLabel>
      <ItemPreview
        item={{
          id: 'mcp-auth',
          type: 'mcp_tool_call',
          server: 'linear',
          tool: 'list_issues',
          arguments: {},
          status: 'failed',
          authRequired: true,
          error: { message: 'MCP authentication required' },
          result: {
            content: [],
            structuredContent: null,
            meta: { 'mcp/www_authenticate': { authorizationUrl: 'https://auth.example/go' } },
          },
        }}
      />
      <StoryLabel>File change failure</StoryLabel>
      <ItemPreview
        item={{
          id: 'file-failed',
          type: 'file_change',
          changes: [{ path: 'src/chat/ToolBlock.tsx', kind: 'update' }],
          status: 'failed',
        }}
      />
      <StoryLabel>Web search failure</StoryLabel>
      <ItemPreview
        item={{
          id: 'search-failed',
          type: 'web_search',
          query: 'current tool ui conventions',
          status: 'failed',
        }}
      />
    </>
  ),
}

const CONSECUTIVE_ITEMS: CodexThreadItem[] = [
  { id: 'think-1', type: 'reasoning', text: 'Inspect the geometry first.', startedAt: 0, endedAt: 8000 },
  {
    id: 'edit-script',
    type: 'file_change',
    changes: [{ path: '/tmp/inspect-geometry.ts', kind: 'update', diff: '-a\n+b\n' }],
    status: 'completed',
  },
  {
    id: 'run-script',
    type: 'command_execution',
    command: "/bin/zsh -lc 'bun /tmp/inspect-geometry.ts'",
    aggregatedOutput: 'ok\n',
    exitCode: 0,
    status: 'completed',
  },
  {
    id: 'grep-mesh',
    type: 'command_execution',
    command: 'rg "def Mesh" model.usda',
    aggregatedOutput: '',
    exitCode: 0,
    status: 'completed',
    commandActions: [{ type: 'search', query: 'def Mesh', path: 'model.usda' }],
  },
  {
    id: 'browser-navigate',
    type: 'mcp_tool_call',
    server: 'superone',
    tool: 'browser_tabs',
    arguments: { action: 'navigate', url: 'http://localhost:5173', description: 'Open the preview' },
    result: { content: [{ type: 'text', text: 'ok' }], structuredContent: {} },
    status: 'completed',
  },
  {
    id: 'browser-screenshot',
    type: 'mcp_tool_call',
    server: 'superone',
    tool: 'browser_action',
    arguments: { action: 'screenshot', description: 'Capture the preview' },
    result: { content: [{ type: 'text', text: 'ok' }], structuredContent: {} },
    status: 'completed',
  },
  { id: 'search', type: 'web_search', query: 'usd mesh uv', status: 'completed' },
  {
    id: 'edit-two',
    type: 'file_change',
    changes: [
      { path: 'src/a.ts', kind: 'update', diff: '-a\n+b\n' },
      { path: 'src/b.ts', kind: 'add', diff: '+c\n' },
    ],
    status: 'completed',
  },
  {
    id: 'read-a',
    type: 'command_execution',
    command: "sed -n '1,80p' src/a.ts",
    aggregatedOutput: '',
    exitCode: 0,
    status: 'completed',
    commandActions: [{ type: 'read', path: 'src/a.ts' }],
  },
  {
    id: 'read-b',
    type: 'command_execution',
    command: "sed -n '1,80p' src/b.ts",
    aggregatedOutput: '',
    exitCode: 0,
    status: 'completed',
    commandActions: [{ type: 'read', path: 'src/b.ts' }],
  },
  {
    id: 'app-find',
    type: 'mcp_tool_call',
    server: 'superone',
    tool: 'miniapp_call',
    arguments: { appId: 'project-tools', tool: 'find_files', arguments: { query: 'tool ui' } },
    status: 'completed',
  },
  {
    id: 'app-inspect',
    type: 'mcp_tool_call',
    server: 'superone',
    tool: 'miniapp_call',
    arguments: { appId: 'project-tools', tool: 'inspect_file', arguments: { path: 'tool-row.tsx' } },
    status: 'completed',
  },
  {
    id: 'github-pr',
    type: 'mcp_tool_call',
    server: 'github',
    tool: 'get_pull_request',
    arguments: { number: 42 },
    status: 'completed',
  },
  {
    id: 'follow-up',
    type: 'collab_tool_call',
    tool: 'sendInput',
    status: 'completed',
    receiverThreadIds: ['reviewer-thread'],
    agentsStates: { 'reviewer-thread': { status: 'running', nickname: 'Reviewer' } },
    prompt: 'Check the spacing too.',
  },
  { id: 'image', type: 'image_generation', status: 'failed', revisedPrompt: 'A quiet workspace' },
  { id: 'compacted', type: 'compaction' },
  { id: 'failed', type: 'error', message: 'Stream disconnected' },
  { id: 'done', type: 'agent_message', text: 'Every row above should sit the same distance apart.' },
]

/** Every Codex item kind back to back: consecutive rows must keep one uniform gap. */
export const ConsecutiveToolSpacing: Story = {
  render: () => (
    <CodexTurnView message={turnMessage('consecutive', CONSECUTIVE_ITEMS)} isStreaming={false} isLastAssistant />
  ),
}
