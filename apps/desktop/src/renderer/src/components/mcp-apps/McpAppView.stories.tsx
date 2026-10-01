import type { Meta, StoryObj } from '@storybook/react-vite'
import { useMemo, useEffect, useRef } from 'react'
import { Button } from '@superone/ui/components/ui/button'
import { ToolBlock } from '@/components/chat/ToolBlock'
import { WidgetBlock } from '@/components/chat/WidgetBlock'
import { PrettyJSONCodeBlock } from '@/components/chat/tool-result-views'
import { useSettingsStore } from '@/stores/settings'
import { McpAppHostLayer } from './McpAppHostLayer'
import { useMcpAppLayout, type McpAppSurface } from './layout-store'
import McpAppView from './McpAppView'
import { createMcpAppStoryFixture, type McpAppStoryState } from './story-fixture'

function Scenario({ state = 'live', narrow = false, scrolling = false, initialMode = 'inline' }: { state?: McpAppStoryState; narrow?: boolean; scrolling?: boolean; initialMode?: McpAppSurface }) {
  const boundary = useRef<HTMLDivElement>(null)
  const fixture = useMemo(() => createMcpAppStoryFixture(state), [state])
  useEffect(() => {
    useSettingsStore.setState(state => ({ mcpMetaCache: { ...state.mcpMetaCache, [fixture.app.binding.server]: { name: fixture.app.binding.server, icons: [{ src: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"%3E%3Cpath fill="%237c3aed" d="M2 1h12v14H2z"/%3E%3C/svg%3E' }] } } }))
    useMcpAppLayout.getState().setMode(fixture.app.appInstanceId, initialMode)
  }, [fixture, initialMode])
  const toolName = `mcp__${fixture.app.binding.server}__fixture_list_items`
  return <><McpAppHostLayer boundary={boundary} /><div ref={boundary} className="relative h-screen">
    <div data-chat-root data-mcp-transcript className="mx-auto min-w-0 overflow-y-auto p-4" style={{ width: narrow ? 320 : 720, maxWidth: '100%', height: scrolling ? 600 : undefined }}>
      {scrolling && <div className="h-60 text-xs text-muted-foreground">Earlier transcript content</div>}
      <div data-normal-mcp-row><ToolBlock toolName={`mcp__${fixture.app.binding.server}__fixture_model_echo`} input='{"text":"normal MCP tool"}' status="complete" result="Normal MCP result" autoExpand={false} /></div>
      <div data-app-mcp-row><McpAppView app={fixture.app} api={fixture.api} route={{ projectPath: '/storybook', sessionId: fixture.app.binding.session }} title="fixture list items"
        renderFallback={trailing => <ToolBlock toolName={toolName} input='{"page":1}' status="complete" result="page 1" autoExpand={false} trailing={trailing} />}
        details={<div className="rounded-md bg-muted/20 p-2"><PrettyJSONCodeBlock text='{"page":1}' /><PrettyJSONCodeBlock text='{"page":1,"items":["Item 1-1"]}' /></div>} /></div>
      <div data-comparison-widget><WidgetBlock data={{ title: 'Widget comparison', widget_code: '<div style="padding:20px;background:var(--color-background-secondary);border-radius:6px">A widget shares the same hover header and borderless frame.</div>', isSVG: false, width: 680, height: 100 }} /></div>
      {scrolling && <div className="h-[1000px] text-xs text-muted-foreground">Later transcript content</div>}
      {state === 'revoked' && <Button variant="outline" onClick={fixture.revoke}>Simulate Navigation</Button>}
    </div>
  </div></>
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
export const DisplayModes: Story = {}
export const ChineseNarrow: Story = { args: { narrow: true }, globals: { locale: 'zh' } }
export const ScrollingTranscript: Story = { args: { scrolling: true } }
export const Fullscreen: Story = { args: { initialMode: 'fullscreen' } }
export const PictureInPicture: Story = { args: { initialMode: 'pip' } }
