import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { ToolBlock } from './ToolBlock'

function StoryShell({ children, width = 640 }: { children: ReactNode; width?: number }) {
  return (
    <div className="@container" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

const meta: Meta<typeof ToolBlock> = {
  title: 'ClaudeCode/GenericToolHeader',
  component: ToolBlock,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <StoryShell><Story /></StoryShell>],
}

export default meta
type Story = StoryObj<typeof ToolBlock>

export const ReadStreaming: Story = {
  args: {
    toolName: 'Read',
    input: JSON.stringify({ file_path: '/Users/me/projects/super-one/src/main/index.ts', offset: 1, limit: 100 }),
    status: 'streaming',
    elapsedSeconds: 2,
  },
}

export const ReadComplete: Story = {
  args: {
    toolName: 'Read',
    input: JSON.stringify({ file_path: '/Users/me/projects/super-one/src/main/index.ts' }),
    status: 'complete',
  },
}

export const ReadDenied: Story = {
  args: {
    toolName: 'Read',
    input: JSON.stringify({ file_path: '/Users/me/secrets/.env' }),
    status: 'complete',
    result: '[denied] User denied permission',
  },
}

export const GrepComplete: Story = {
  args: {
    toolName: 'Grep',
    input: JSON.stringify({ pattern: 'function\\s+ToolBlock', path: 'src/renderer/src/components/chat' }),
    status: 'complete',
    result: '3 matches across 2 files\nsrc/renderer/src/components/chat/ToolBlock.tsx:231\nsrc/renderer/src/components/chat/ToolBlock.tsx:1035',
  },
}

export const GrepStreaming: Story = {
  args: {
    toolName: 'Grep',
    input: JSON.stringify({ pattern: 'TODO', glob: '**/*.ts' }),
    status: 'streaming',
    elapsedSeconds: 1,
  },
}

export const GlobComplete: Story = {
  args: {
    toolName: 'Glob',
    input: JSON.stringify({ pattern: '**/*.test.ts', path: 'src' }),
    status: 'complete',
    result: 'Found 42 files',
  },
}

export const WebSearchComplete: Story = {
  args: {
    toolName: 'WebSearch',
    input: JSON.stringify({ query: 'electron-vite vs electron-forge comparison' }),
    status: 'complete',
    result: 'Found 8 results from web search',
  },
}

export const WebFetchComplete: Story = {
  args: {
    toolName: 'WebFetch',
    input: JSON.stringify({ url: 'https://docs.claude.com/en/api/agent-sdk' }),
    status: 'complete',
    result: 'Fetched 12kb of HTML content',
  },
}

export const WebFetchError: Story = {
  args: {
    toolName: 'WebFetch',
    input: JSON.stringify({ url: 'https://does-not-exist.example.com' }),
    status: 'complete',
    result: 'getaddrinfo ENOTFOUND does-not-exist.example.com',
    isError: true,
  },
}

export const ToolSearchComplete: Story = {
  args: {
    toolName: 'ToolSearch',
    input: JSON.stringify({ query: 'notebook jupyter' }),
    status: 'complete',
    result: '1 tool matched: NotebookEdit',
  },
}

export const SkillRunning: Story = {
  args: {
    toolName: 'Skill',
    input: JSON.stringify({ skill: 'simplify' }),
    status: 'streaming',
    elapsedSeconds: 3,
  },
}

export const SkillComplete: Story = {
  args: {
    toolName: 'Skill',
    input: JSON.stringify({ skill: 'release' }),
    status: 'complete',
  },
}

export const TaskOutputWaiting: Story = {
  args: {
    toolName: 'TaskOutput',
    input: JSON.stringify({ task_id: 'task-abc-123' }),
    status: 'streaming',
    elapsedSeconds: 5,
  },
}

export const TodoListComplete: Story = {
  args: {
    toolName: 'TodoList',
    input: JSON.stringify({ total: 8, completed: 5 }),
    status: 'complete',
  },
}
