import { useEffect, useState, type ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { McpAppHostResult, ToolAppAttachment } from '@superone/shared/mcp-apps'
// The same View the fixture MCP server serves, so the stories drive the real wire protocol.
import FIXTURE_VIEW_HTML from '../../../apps/desktop/src/test/fixtures/mcp-apps/fixture-view.html?raw'
import { installFakeNativeHost } from './fixtures/native-host'
import { noteMcpAppArrivals } from './mcp-app-document'
import { PortableMcpAppView } from './PortableMcpAppView'
import { PortableTurnContext } from './portable-turn-context'
import { PortableToolRow } from './PortableToolRow'
import { PortableWidgetBlock } from './PortableWidgetBlock'

type HostMode = 'ok' | 'slow' | 'fails' | 'auth'

const ITEMS = Array.from({ length: 12 }, (_, i) => `item-${i + 1}`)
function page(n: number) {
  const pageCount = 4
  const clamped = Math.min(Math.max(1, n), pageCount)
  const items = ITEMS.slice((clamped - 1) * 3, clamped * 3)
  return {
    content: [{ type: 'text', text: `Page ${clamped}/${pageCount}: ${items.join(', ')}` }],
    structuredContent: { items, page: clamped, pageCount },
    _meta: { 'fixture/private': { token: `private-${clamped}` } },
  }
}
const RESOURCE = { html: FIXTURE_VIEW_HTML, hash: 'fixture-v1', meta: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: true } }

function attachment(id: string, overrides: Partial<ToolAppAttachment> = {}): ToolAppAttachment {
  return {
    appInstanceId: id,
    binding: { node: 'local', session: 'story', server: 'mcp-apps-fixture', configGeneration: 1, configFingerprint: 'fixture' },
    origin: { providerSessionId: 'thread-1' },
    harnessCallId: `call-${id}`,
    resourceUri: 'ui://fixture/items.html',
    presentation: { toolTitle: 'Browse library', serverTitle: 'MCP Apps Fixture', serverIcons: [{ src: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"%3E%3Cpath fill="%237c3aed" d="M2 2h16v16H2z"/%3E%3C/svg%3E' }] },
    toolInput: { page: 1 },
    toolResult: page(1),
    status: 'result',
    ...overrides,
  }
}

/**
 * Stands in for RN and the desktop: answers the `mcpApp` native action the way the host
 * executor does, including main-issued approval challenges and the visibility gate.
 */
function answer(mode: HostMode, request: Record<string, unknown>): McpAppHostResult {
  const challenged = typeof request.approval === 'object'
  // A live View's first request is `activate`, a restored one's `load`; either can fail.
  if (request.operation === 'activate' || request.operation === 'load') {
    if (mode === 'fails') return { ok: false, error: { code: 'not_connected', message: 'The desktop is offline' } }
    if (mode === 'auth') return { ok: false, error: { code: 'auth_required', message: 'Sign in required', challenge: ['Bearer'] } }
  }
  switch (request.operation) {
    case 'load':
      return { ok: true, value: RESOURCE }
    case 'activate':
    case 'updateModelContext':
    case 'readResource':
      return { ok: true, value: {} }
    case 'callTool':
      // The user's tap in the View is consent; only the visibility gate applies.
      if (request.tool !== 'fixture_next_page') return { ok: false, error: { code: 'denied', message: 'This tool is not available to the App' } }
      return { ok: true, value: { result: page(Number((request.args as { page?: number }).page) || 1), outcome: 'completed' } }
    case 'sendMessage': {
      if (challenged) return { ok: true, value: {} }
      const params = request.params as { content: Array<{ type: string; text?: string }> }
      return { ok: false, error: { code: 'approval_required', challenge: 'story-message', prompt: {
        kind: 'sendMessage', server: 'mcp-apps-fixture',
        text: params.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n'),
        nonTextBlocks: params.content.filter((block) => block.type !== 'text').length,
      } } }
    }
    default:
      return { ok: false, error: { code: 'invalid', message: 'Unknown operation' } }
  }
}

function MockHost({ mode, children }: { mode: HostMode; children: ReactNode }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const uninstall = installFakeNativeHost((message, reply) => {
      if (message.action !== 'mcpApp') { console.info('[native]', message.action, message.payload); return }
      if (mode === 'slow') return
      const result = answer(mode, message.payload ?? {})
      setTimeout(() => reply({ result: { ok: true, response: result } }), 150)
    })
    setReady(true)
    return uninstall
  }, [mode])
  return ready ? <>{children}</> : null
}

interface Args {
  app: ToolAppAttachment
  arrival: 'live' | 'restored'
  mode: HostMode
  width: number
  /** A transcript shorter than the View, which scrolls like the phone's. */
  height?: number
  /** A widget and a plain MCP call around the View, to compare their frames. */
  neighbours?: boolean
}

const TOOL_NAME = 'mcp__mcp-apps-fixture__fixture_list_items'

function ToolRow({ app, trailing, expanded }: { app: ToolAppAttachment; trailing?: ReactNode; expanded?: boolean }) {
  const result = (app.toolResult as ReturnType<typeof page> | undefined)?.content[0]?.text
  return (
    <PortableToolRow
      toolName={TOOL_NAME}
      toolUseId={app.harnessCallId ?? app.appInstanceId}
      input={JSON.stringify(app.toolInput ?? {})}
      status={app.status === 'pending' ? 'streaming' : 'complete'}
      result={result}
      trailing={trailing}
      defaultExpanded={expanded}
      presentation={app.presentation}
    />
  )
}

const WIDGET = {
  title: 'weekly_summary',
  widget_code: '<div style="padding:16px;font:14px system-ui;color:var(--color-text-primary)">A widget the agent drew</div>',
  width: 800,
  height: 120,
  isSVG: false,
}

function Preview({ app, arrival, mode, neighbours }: Args) {
  // How the View reached the document decides whether it may call out before activation.
  const [noted] = useState(() => {
    noteMcpAppArrivals([{ id: 'm', role: 'assistant', status: 'complete', createdAt: '', providerId: 'claude', content: [{ type: 'tool_result', toolUseId: 't', summary: '', app }] }], arrival)
    return true
  })
  if (!noted) return null
  const view = <PortableMcpAppView app={app} messageId="m" toolName={TOOL_NAME} row={({ trailing, expanded } = {}) => <ToolRow app={app} trailing={trailing} expanded={expanded} />} />
  return (
    <MockHost mode={mode}>
      {neighbours ? (
        <>
          <PortableWidgetBlock data={WIDGET} />
          <PortableToolRow toolName="mcp__mcp-apps-fixture__fixture_status" toolUseId="plain" input="{}" status="complete" result="ok" />
          {view}
        </>
      ) : view}
    </MockHost>
  )
}

let next = 0
const id = (name: string) => `${name}-${++next}`

const meta = {
  title: 'Chat/SuperOne/Portable MCP App',
  component: Preview,
  parameters: { layout: 'padded' },
  decorators: [(Story, context) => (
    <PortableTurnContext.Provider value={{ scheme: context.globals.theme === 'light' ? 'light' : 'dark', pendingPermission: null, mcpIcons: (context.parameters.mcpIcons as Record<string, string> | undefined) ?? {}, projectPath: null }}>
      <div style={{ width: context.args.width, height: context.args.height, overflowY: context.args.height ? 'auto' : undefined, colorScheme: context.globals.theme === 'light' ? 'light' : 'dark' }}><Story /></div>
    </PortableTurnContext.Provider>
  )],
  args: { app: attachment(id('live')), arrival: 'live', mode: 'ok', width: 390 },
} satisfies Meta<typeof Preview>

export default meta
type Story = StoryObj<typeof meta>

/** Next page runs at once; Ask the model is confirmed first; the model-only button is refused by the host. */
export const Live: Story = { name: 'Live · app-only paging, denied model-only call' }

export const Loading: Story = { name: 'Loading · host has not answered', args: { app: attachment(id('slow')), mode: 'slow' } }

export const LoadFailed: Story = { name: 'Load failed · retry', args: { app: attachment(id('fails')), mode: 'fails' } }

export const AuthRequired: Story = { name: 'Auth required · sign in on the desktop', args: { app: attachment(id('auth')), mode: 'auth' } }

/** The snapshot waits for `activate`: the View calls out as soon as it runs. */
export const LiveWithSnapshot: Story = {
  name: 'Live with snapshot · activates before it runs',
  args: { app: attachment(id('live-snapshot'), { resource: RESOURCE }) },
}

export const LiveActivationFails: Story = {
  name: 'Live with snapshot · activation fails, retry',
  args: { app: attachment(id('live-snapshot-fails'), { resource: RESOURCE }), mode: 'fails' },
}

export const RestoredWithSnapshot: Story = {
  name: 'Restored · paints the snapshot, calls nothing until activated',
  args: { app: attachment(id('restored'), { resource: RESOURCE, toolResult: page(2) }), arrival: 'restored' },
}

export const RestoredWithoutSnapshot: Story = {
  name: 'Restored without snapshot · activate to load',
  args: { app: attachment(id('restored-empty')), arrival: 'restored' },
}

export const Pending: Story = {
  name: 'Pending · input streamed, no result yet',
  args: { app: attachment(id('pending'), { status: 'pending', toolResult: undefined, resource: RESOURCE }) },
}

/** "Navigate away" loads a new document in the frame; its bridge is revoked and the View stops. */
export const NavigatesAway: Story = {
  name: 'Navigates away · revoked, restart',
  args: { app: attachment(id('nav'), { resource: RESOURCE }) },
}

export const Narrow: Story = { name: 'Narrow · 320 px', args: { app: attachment(id('narrow'), { resource: RESOURCE }), width: 320 } }

/** Ask the model's confirmation card lands below a short transcript and scrolls itself into view. */
export const ConsentBelowTheFold: Story = {
  name: 'Consent below the fold · card scrolls into view',
  args: { app: attachment(id('consent-fold'), { resource: RESOURCE }), height: 320 },
}

/** The View reads like the widget above it, not like the plain MCP call between them. */
export const NextToWidgetAndRow: Story = {
  name: 'Next to a widget and a plain MCP row',
  args: { app: attachment(id('neighbours'), { resource: RESOURCE }), neighbours: true },
}

const BRAND_ICON = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#7c3aed"/><path d="M4 11V5l4 3 4-3v6" stroke="#fff" stroke-width="1.6" fill="none"/></svg>')}`

/** With a brand icon the header and the row draw the same one; without, the same tool icon. */
export const NextToWidgetAndRowWithBrandIcon: Story = {
  name: 'Next to a widget and a plain MCP row · brand icon',
  parameters: { mcpIcons: { 'mcp-apps-fixture': BRAND_ICON } },
  args: { app: attachment(id('neighbours-brand'), { resource: RESOURCE }), neighbours: true },
}

export const ToolMetadata: Story = { name: 'Tool title and server icon metadata', args: { app: attachment(id('metadata'), { resource: RESOURCE }) } }
export const LongTitleNarrow: Story = { args: { width: 320, app: attachment(id('long-title'), { resource: RESOURCE, presentation: { toolTitle: 'Browse the engineering library with a very long descriptive tool title', serverTitle: 'Fixture CAD library' } }) } }
