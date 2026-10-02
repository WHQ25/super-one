import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, type ReactNode } from 'react'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { ToolBlock } from './ToolBlock'

const SB_PROJECT = '__storybook_mcp_icon__'

/** ToolBlock reads cwd / homedir from the active session. */
function Seeded({ children, width }: { children: ReactNode; width: number }) {
  useEffect(() => {
    const project = createDefaultProjectState()
    project._activeSessionId = 'sb'
    project._sessions = { sb: { ...createDefaultPerSessionState(), cwd: '/Users/me/project' } }
    useChatStore.setState({ activeProject: SB_PROJECT, projectSessions: { [SB_PROJECT]: project } })
  }, [])
  return <div className="space-y-1" style={{ width, maxWidth: '100%' }}>{children}</div>
}

/**
 * Third-party MCP tool calls whose server has no icon (none declared, none in the
 * MCP library) lead with the MCP mark rather than a generic glyph.
 */
function Rows({ width = 560 }: { width?: number }) {
  return (
    <Seeded width={width}>
      <ToolBlock toolName="mcp__sentry__create_issue" input={JSON.stringify({ title: 'Crash on start' })} status="complete" result="Created SENTRY-412" />
      <ToolBlock toolName="mcp__linear__search_issues_with_a_long_descriptive_tool_name" input={JSON.stringify({ query: 'torque table' })} status="streaming" />
      <ToolBlock toolName="mcp__weather__forecast" input={JSON.stringify({ city: 'Berlin' })} status="complete" result="Upstream timed out" isError />
    </Seeded>
  )
}

const meta = {
  title: 'Tool UI/MCP/Server icon',
  component: Rows,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Rows>

export default meta
type Story = StoryObj<typeof meta>

export const NoServerIcon: Story = {}

export const Narrow: Story = { args: { width: 320 } }
