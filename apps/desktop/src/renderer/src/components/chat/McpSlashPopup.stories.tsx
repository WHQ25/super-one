import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState } from 'react'
import type { McpServerInfo } from '@superone/shared/agent-types'
import { useChatStore, createDefaultPerSessionState, createDefaultProjectState } from '@/stores/chat'
import { McpSlashPopup } from './McpSlashPopup'

const EMPTY: McpServerInfo[] = []

function Preview({ servers = EMPTY, failure = false, narrow = false }: { servers?: McpServerInfo[]; failure?: boolean; narrow?: boolean }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const previous = useChatStore.getState(), environment = window.environment, app = window.app
    useChatStore.setState({ activeProject: '/storybook/mcp', projectSessions: { '/storybook/mcp': {
      ...createDefaultProjectState(), _activeSessionId: 'session', _sessions: { session: {
        ...createDefaultPerSessionState(), preferredProvider: 'opencode', sessionProvider: 'opencode',
      } },
    } } })
    window.environment = { ...environment, callSession: async (_connection: string, _session: string, method: string) => {
      if (failure) throw new Error('MCP status unavailable. Try again.')
      return method === 'session.mcpStatus' ? servers : null
    } } as typeof environment
    window.app = { ...app, checkMcpServers: async () => ({ status: [], meta: {} }), getMcpMetaCache: async () => ({}), listMcpLibrary: async () => [] } as typeof app
    setReady(true)
    return () => { window.environment = environment; window.app = app; useChatStore.setState(previous) }
  }, [servers, failure])
  return ready ? <div style={{ width: narrow ? 320 : 560 }}><McpSlashPopup onClose={() => {}} /></div> : null
}
const meta = { title: 'Chat/McpSlashPopup', component: McpSlashPopup, args: { onClose: () => {} }, parameters: { layout: 'centered' } } satisfies Meta<typeof McpSlashPopup>
export default meta
type Story = StoryObj<typeof meta>
const servers: McpServerInfo[] = [{ name: 'github', status: 'connected', toolCount: 3 }, { name: 'linear', status: 'needs-auth' }]
export const ConnectedAndAuthentication: Story = { render: () => <Preview servers={servers} /> }
export const Empty: Story = { render: () => <Preview /> }
export const ErrorRetry: Story = { render: () => <Preview failure /> }
export const Narrow: Story = { render: () => <Preview servers={servers} narrow /> }
