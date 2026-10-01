import type { Meta, StoryObj } from '@storybook/react-vite'
import { useMemo } from 'react'
import { Button } from '@superone/ui/components/ui/button'
import McpAppView from './McpAppView'
import { createMcpAppStoryFixture, type McpAppStoryState } from './story-fixture'
function Scenario({ state = 'live', narrow = false }: { state?: McpAppStoryState; narrow?: boolean }) {
  const fixture = useMemo(() => createMcpAppStoryFixture(state), [state])
  return <div data-chat-root className="mx-auto min-w-0 p-4" style={{ width: narrow ? 320 : 720, maxWidth: '100%' }}>
    <McpAppView app={fixture.app} api={fixture.api} route={{ projectPath: '/storybook', sessionId: fixture.app.binding.session }} />
    {state === 'revoked' && <Button variant="outline" onClick={fixture.revoke}>Simulate Navigation</Button>}
  </div>
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
