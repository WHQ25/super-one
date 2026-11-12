import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { DefineSubagentToolBlock } from './DefineSubagentToolBlock'
import { ToolBlock } from './ToolBlock'

function StoryShell({ children, width = 720 }: { children: ReactNode; width?: number }) {
  return (
    <div className="@container flex flex-col gap-2" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

function block(
  params: Record<string, unknown>,
  result: string | undefined,
  options: {
    toolName?: string
    isStreaming?: boolean
    isError?: boolean
    isDenied?: boolean
  } = {},
) {
  return (
    <ToolBlock
      toolName={options.toolName ?? 'DefineSubagent'}
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

function compact(params: Record<string, unknown>, result: string | undefined) {
  return <DefineSubagentToolBlock params={params} result={result} isStreaming={false} allowExpand={false} />
}

const DEFINED_OUTPUT = 'Subagent "migration-verifier" defined successfully. It can now be invoked via invoke_subagent.'

const meta: Meta = {
  title: 'Tool UI/General/Define Subagent',
  parameters: { layout: 'padded' },
  decorators: [(Story) => <StoryShell><Story /></StoryShell>],
}

export default meta
type Story = StoryObj

export const CapabilityVariants: Story = {
  render: () => (
    <>
      {block(
        {
          name: 'migration-verifier',
          description: 'Runs schema migrations in an isolated branch and verifies rollback safety.',
          systemPrompt: 'Verify every SQL migration forward and backward against the test fixture database.',
          enableWriteTools: true,
          enableMcpTools: true,
          enableSubagentTools: false,
        },
        DEFINED_OUTPUT,
      )}
      {block(
        {
          name: 'security-auditor',
          description: 'Read-only static audit specialist for authentication boundaries.',
          systemPrompt: 'Inspect auth middleware and report privilege escalation vectors with exact file and line citations.',
        },
        'Subagent "security-auditor" defined successfully. It can now be invoked via invoke_subagent.',
      )}
    </>
  ),
}

export const StatesAndCompact: Story = {
  render: () => (
    <>
      {block(
        { name: 'ui-reviewer', description: 'Checks Storybook variants and dark mode contrast.' },
        undefined,
        { isStreaming: true },
      )}
      {block(
        { name: '../invalid', description: 'Invalid agent path' },
        'Encountered error in step execution: invalid subagent name "../invalid"',
        { isError: true },
      )}
      {block({ name: 'deployer', description: 'Deploys staging release' }, undefined, { isDenied: true })}
      {compact({ name: 'migration-verifier', description: 'Runs schema migrations in an isolated branch.' }, DEFINED_OUTPUT)}
    </>
  ),
}
