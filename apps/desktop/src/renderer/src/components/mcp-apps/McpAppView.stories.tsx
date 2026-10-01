import 'dockview/dist/styles/dockview.css'
import { DockviewReact } from 'dockview-react'
import { setDockApi } from '@/components/activity/activity-panel-api'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { McpAppPanel } from './McpAppSlot'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useMemo, useEffect } from 'react'
import { Button } from '@superone/ui/components/ui/button'
import McpAppView from './McpAppView'
import { createMcpAppStoryFixture, type McpAppStoryState } from './story-fixture'
function Scenario({ state = 'live', narrow = false, dock = false }: { state?: McpAppStoryState; narrow?: boolean; dock?: boolean }) {
  const fixture = useMemo(() => createMcpAppStoryFixture(state), [state])
  useEffect(() => () => { if (dock) setDockApi(null) }, [dock])
  return <div className={dock ? 'grid h-screen grid-cols-[minmax(0,1fr)_400px]' : ''}><div data-chat-root className="mx-auto min-w-0 p-4" style={{ width: narrow ? 320 : 720, maxWidth: '100%' }}>
    <McpAppView app={fixture.app} api={fixture.api} route={{ projectPath: '/storybook', sessionId: fixture.app.binding.session }} />
    {state === 'revoked' && <Button variant="outline" onClick={fixture.revoke}>Simulate Navigation</Button>}
  </div>{dock && <DockviewReact className="dockview-theme-superone" components={{ 'mcp-app': McpAppPanel }} onReady={event => { setDockApi(event.api); useActivityPanelStore.getState().setShowPanel(true) }} />}</div>
}
const meta: Meta<typeof Scenario> = { title: 'Chat/MCP Apps', component: Scenario, parameters: { layout: 'fullscreen' } }
export default meta
type Story = StoryObj<typeof Scenario>
export const Live: Story = {}
export const Loading: Story = { args: { state: 'loading' } }
export const RestoredInactive: Story = { args: { state: 'inactive' } }
export const RestoredWithoutSnapshot: Story = { args: { state: 'missing' } }
export const Approval: Story = { args: { state: 'approval' } }
export const AuthRequired: Story = { args: { state: 'auth' } }
export const ErrorRetry: Story = { args: { state: 'error' } }
export const UnknownOutcome: Story = { args: { state: 'unknown' } }
export const RevokedRestart: Story = { args: { state: 'revoked' } }
export const LongContent: Story = { args: { state: 'long' } }
export const Narrow: Story = { args: { narrow: true } }
export const Light: Story = { globals: { theme: 'light' } }
export const Dark: Story = { globals: { theme: 'dark' } }

export const DisplayModes: Story = { args: { dock: true } }
export const ChineseNarrow: Story = { args: { narrow: true }, globals: { locale: 'zh' } }
