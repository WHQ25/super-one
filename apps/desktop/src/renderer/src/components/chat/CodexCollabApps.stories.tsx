import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState } from 'react'
import type { CodexCollabToolCallItem, CodexMcpToolCallItem } from '@superone/shared/agent-types'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { McpAppHostLayer } from '../mcp-apps/McpAppHostLayer'
import { createMcpAppStoryFixture, type McpAppStoryState } from '../mcp-apps/story-fixture'
import { CodexCollabBlock, CodexSubagentMarker } from './CodexCollabBlock'

function Scenario({ state = 'live', nested = false, marker = false, narrow = false }: { state?: McpAppStoryState; nested?: boolean; marker?: boolean; narrow?: boolean }) {
  const [fixture] = useState(() => {
    const value = createMcpAppStoryFixture(state)
    const project = createDefaultProjectState()
    useChatStore.setState({ activeProject: '/storybook/codex-app-child', projectSessions: {
      '/storybook/codex-app-child': { ...project, _activeSessionId: value.app.binding.session,
        _sessions: { [value.app.binding.session]: createDefaultPerSessionState() } },
    } })
    value.app.origin = { providerSessionId: 'child-thread' }
    const original = window.environment
    window.environment = { ...original, ...value.api } as typeof window.environment
    return { ...value, original }
  })
  useEffect(() => () => { window.environment = fixture.original }, [fixture])
  const call: CodexMcpToolCallItem = { id: 'child-call', type: 'mcp_tool_call', server: fixture.app.binding.server, tool: 'fixture_list_items', arguments: { page: 1 }, status: 'completed', app: fixture.app }
  const collab = (id: string, childItems: CodexCollabToolCallItem['childItems']): CodexCollabToolCallItem => ({ id, type: 'collab_tool_call', tool: 'spawnAgent', status: 'completed', receiverThreadIds: Object.keys(childItems ?? {}), agentsStates: { 'child-thread': { status: 'completed', nickname: 'Library helper', role: 'worker' } }, childItems })
  const item = collab('spawn', { 'child-thread': nested ? [collab('spawn-grandchild', { grandchild: [call] })] : [call] })
  return <><McpAppHostLayer /><div data-chat-root data-mcp-transcript className="@container mx-auto w-full p-4" style={{ maxWidth: narrow ? 340 : 720 }}>
    {marker ? <CodexSubagentMarker item={item} /> : <CodexCollabBlock items={[item]} isStreaming={false} defaultExpanded />}
  </div></>
}

const meta: Meta<typeof Scenario> = { title: 'Tool UI/Codex/Subagent MCP Apps', component: Scenario, parameters: { layout: 'fullscreen' } }
export default meta
type Story = StoryObj<typeof Scenario>
export const Live: Story = {}
export const Loading: Story = { args: { state: 'loading' } }
export const Restored: Story = { args: { state: 'inactive' } }
export const ErrorRetry: Story = { args: { state: 'error' } }
export const Narrow: Story = { args: { narrow: true } }
export const NestedChild: Story = { args: { nested: true } }
export const Marker: Story = { args: { marker: true } }
