import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { McpResourceToolBlock } from './McpResourceToolBlock'
import { ToolBlock } from './ToolBlock'

function StoryShell({ children, width = 720 }: { children: ReactNode; width?: number }) {
  return (
    <div className="@container flex flex-col gap-2" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

function block(
  toolName: string,
  params: Record<string, unknown>,
  result: string | undefined,
  options: {
    isStreaming?: boolean
    isError?: boolean
    isDenied?: boolean
  } = {},
) {
  return (
    <ToolBlock
      toolName={toolName}
      input={JSON.stringify(params)}
      result={
        options.isDenied
          ? '[denied] User denied permission'
          : options.isStreaming
            ? undefined
            : result
      }
      status={options.isStreaming ? 'streaming' : 'complete'}
      isError={options.isError}
    />
  )
}

const RESOURCES_JSON = JSON.stringify({
  resources: [
    {
      uri: 'mcp://context7/docs/react-19-hooks',
      name: 'React 19 Hooks Reference',
      mimeType: 'text/markdown',
      description: 'Server actions, useOptimistic, and transition APIs',
    },
    {
      uri: 'mcp://context7/docs/vite-6-config',
      name: 'Vite 6 Configuration',
      mimeType: 'text/markdown',
      description: 'Environment API and bundler options',
    },
  ],
})

const READ_RESOURCE_TEXT = [
  'Resource (mcp://context7/docs/react-19-hooks):',
  '# React 19 Hooks',
  '',
  '- `useActionState(fn, initialState)`',
  '- `useOptimistic(state, updateFn)`',
].join('\n')

const meta: Meta = {
  title: 'Tool UI/General/MCP Resources',
  parameters: { layout: 'padded' },
  decorators: [(Story) => <StoryShell><Story /></StoryShell>],
}

export default meta
type Story = StoryObj

export const ListAndReadResources: Story = {
  render: () => (
    <>
      {block('ListMcpResources', { server: 'context7' }, RESOURCES_JSON)}
      {block('ListMcpResources', { server: 'agent-memory' }, 'No resources found.')}
      {block(
        'ReadMcpResource',
        { server: 'context7', uri: 'mcp://context7/docs/react-19-hooks' },
        READ_RESOURCE_TEXT,
      )}
    </>
  ),
}

export const StatesAndCompact: Story = {
  render: () => (
    <>
      {block('ListMcpResources', { server: 'context7' }, undefined, { isStreaming: true })}
      {block(
        'ReadMcpResource',
        { server: 'context7', uri: 'mcp://context7/docs/missing' },
        'Encountered error in step execution: Resource not found',
        { isError: true },
      )}
      <McpResourceToolBlock
        toolName="ReadMcpResource"
        params={{ server: 'context7', uri: 'mcp://context7/docs/react-19-hooks' }}
        result={READ_RESOURCE_TEXT}
        isStreaming={false}
        allowExpand={false}
      />
    </>
  ),
}
