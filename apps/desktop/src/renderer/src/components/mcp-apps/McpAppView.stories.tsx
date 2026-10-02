import type { Meta, StoryObj } from '@storybook/react-vite'
import { useMemo, useEffect } from 'react'
import { Button } from '@superone/ui/components/ui/button'
import { ToolBlock } from '@/components/chat/ToolBlock'
import { WidgetBlock } from '@/components/chat/WidgetBlock'
import { PrettyJSONCodeBlock } from '@/components/chat/tool-result-views'
import { useSettingsStore } from '@/stores/settings'
import { ActivityPanel } from '@/components/activity/ActivityPanel'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { McpAppHostLayer } from './McpAppHostLayer'
import { useMcpAppLayout, type McpAppSurface } from './layout-store'
import McpAppView from './McpAppView'
import { createMcpAppStoryFixture, type McpAppStoryState } from './story-fixture'

/** Bits & Bolts' real icon: one hard-coded dark stroke that a dark theme would swallow. */
const DARK_STROKE_ICON = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path fill="none" stroke="#27272a" stroke-width="3" stroke-linejoin="round" d="M9.5 4.75h13L29 16l-6.5 11.25h-13L3 16zM13 10.8h6l3 5.2-3 5.2h-6L10 16z"/></svg>')

function Scenario({ state = 'live', narrow = false, scrolling = false, initialMode = 'inline', restoredContext = false, cachedReference = false, resultOmitted = false, topRightControl = false, darkStrokeIcon = false }: { darkStrokeIcon?: boolean; topRightControl?: boolean; resultOmitted?: boolean; cachedReference?: boolean; restoredContext?: boolean; state?: McpAppStoryState; narrow?: boolean; scrolling?: boolean; initialMode?: McpAppSurface }) {
  const maximized = useActivityPanelStore(state => state.maximized)
  const fixture = useMemo(() => {
    const value = createMcpAppStoryFixture(state, { topRightControl })
    if (restoredContext) value.app.modelContext = { updateId: 'restored-context-id', content: [{ type: 'text', text: 'Selected part', _meta: { 'openai/title': 'Agent dial' } }], source: { appInstanceId: value.app.appInstanceId, server: value.app.binding.server } }
    if (resultOmitted) value.app.toolResultOmitted = { bytes: 1050849, reason: 'size_limit' }
    if (cachedReference) value.app.resource = { hash: 'a'.repeat(64), meta: {} }
    if (darkStrokeIcon && value.app.presentation) value.app.presentation = { ...value.app.presentation, icons: [{ src: DARK_STROKE_ICON }] }
    return value
  }, [state, restoredContext, cachedReference, resultOmitted, topRightControl, darkStrokeIcon])
  useEffect(() => {
    useSettingsStore.setState(state => ({ mcpMetaCache: { ...state.mcpMetaCache, [fixture.app.binding.server]: { name: fixture.app.binding.server, icons: [{ src: darkStrokeIcon ? DARK_STROKE_ICON : 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"%3E%3Cpath fill="%237c3aed" d="M2 1h12v14H2z"/%3E%3C/svg%3E' }] } } }))
    useMcpAppLayout.getState().setMode(fixture.app.appInstanceId, initialMode)
  }, [fixture, initialMode, darkStrokeIcon])
  const toolName = `mcp__${fixture.app.binding.server}__fixture_list_items`
  return <><McpAppHostLayer /><div className="relative flex h-screen">
    <ActivityPanel getMaxWidth={() => window.innerWidth} transitionMs={0} />
    <div data-chat-root data-mcp-transcript className="mx-auto min-w-0 overflow-y-auto p-4" style={{ display: maximized ? 'none' : undefined, width: narrow ? 320 : 720, maxWidth: '100%', height: scrolling ? 600 : undefined }}>
      {scrolling && <div className="h-60 text-xs text-muted-foreground">Earlier transcript content</div>}
      <div data-normal-mcp-row><ToolBlock toolName={`mcp__${fixture.app.binding.server}__fixture_model_echo`} input='{"text":"normal MCP tool"}' status="complete" result="Normal MCP result" autoExpand={false} /></div>
      <div data-app-mcp-row><McpAppView app={fixture.app} toolName={toolName} api={fixture.api} route={{ projectPath: '/storybook', sessionId: fixture.app.binding.session }} title="fixture list items"
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
/** A one-colour dark-stroke server icon in the App header and the MCP tool row follows the text colour. */
export const DarkStrokeIcon: Story = { args: { darkStrokeIcon: true }, globals: { theme: 'dark' } }
export const DisplayModes: Story = {}
export const ChineseNarrow: Story = { args: { narrow: true }, globals: { locale: 'zh' } }
export const ScrollingTranscript: Story = { args: { scrolling: true } }
export const Fullscreen: Story = { args: { initialMode: 'fullscreen' } }
export const PictureInPicture: Story = { args: { initialMode: 'pip' } }

/** Metadata comes from the attachment, without relying on the desktop icon cache. */
export const ToolMetadata: Story = {}

export const RestoredModelContext: Story = { args: { state: 'inactive', restoredContext: true } }

export const RestoredResourceReference: Story = { args: { state: 'inactive', cachedReference: true } }
export const CachedReferenceLoading: Story = { args: { state: 'loading', cachedReference: true } }
export const CachedReferenceRetry: Story = { args: { state: 'error', cachedReference: true } }

export const RestoredOmittedResult: Story = { args: { state: 'inactive', cachedReference: true, resultOmitted: true } }
export const RestoredOmittedResultNarrow: Story = { args: { state: 'inactive', cachedReference: true, resultOmitted: true, narrow: true } }
export const RestoredOmittedResultWithViewControl: Story = { args: { state: 'inactive', cachedReference: true, resultOmitted: true, topRightControl: true, narrow: true } }
