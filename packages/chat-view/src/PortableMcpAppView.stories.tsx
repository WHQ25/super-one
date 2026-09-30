import { useEffect, useState, type ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ToolAppAttachment } from '@superone/shared/mcp-apps'
// The same View the fixture MCP server serves, so the stories drive the real wire protocol.
import FIXTURE_VIEW_HTML from '../../../apps/desktop/src/test/fixtures/mcp-apps/fixture-view.html?raw'
import { installFakeNativeHost } from './fixtures/native-host'
import { noteMcpAppArrivals } from './mcp-app-document'
import type { McpAppHostResult } from './mcp-app-executor'
import { PortableMcpAppView } from './PortableMcpAppView'
import { PortableTurnContext } from './portable-turn-context'

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
function answer(mode: HostMode, request: Record<string, unknown>, remembered: Set<string>): McpAppHostResult {
  const challenged = typeof request.approval === 'object'
  switch (request.operation) {
    case 'load':
      if (mode === 'fails') return { ok: false, error: { code: 'not_connected', message: 'The desktop is offline' } }
      if (mode === 'auth') return { ok: false, error: { code: 'auth_required', message: 'Sign in required', challenge: ['Bearer'] } }
      return { ok: true, value: RESOURCE }
    case 'activate':
    case 'updateModelContext':
    case 'readResource':
      return { ok: true, value: {} }
    case 'callTool': {
      if (request.tool !== 'fixture_next_page') return { ok: false, error: { code: 'denied', message: 'This tool is not available to the App' } }
      if (!remembered.has('fixture_next_page') && !challenged) {
        return { ok: false, error: { code: 'approval_required', challenge: 'story-challenge', prompt: {
          kind: 'callTool', server: 'mcp-apps-fixture', tool: 'fixture_next_page', argsPreview: JSON.stringify(request.args, null, 2), rememberable: true,
        } } }
      }
      if ((request.approval as { remember?: boolean } | undefined)?.remember) remembered.add('fixture_next_page')
      return { ok: true, value: { result: page(Number((request.args as { page?: number }).page) || 1), outcome: 'completed' } }
    }
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
    const remembered = new Set<string>()
    const uninstall = installFakeNativeHost((message, reply) => {
      if (message.action !== 'mcpApp') { console.info('[native]', message.action, message.payload); return }
      if (mode === 'slow') return
      const result = answer(mode, message.payload ?? {}, remembered)
      setTimeout(() => reply({ result }), 150)
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
}

function Preview({ app, arrival, mode }: Args) {
  // How the View reached the document decides whether it may call out before activation.
  const [noted] = useState(() => {
    noteMcpAppArrivals([{ id: 'm', role: 'assistant', status: 'complete', createdAt: '', providerId: 'claude', content: [{ type: 'tool_result', toolUseId: 't', summary: '', app }] }], arrival)
    return true
  })
  return noted ? <MockHost mode={mode}><PortableMcpAppView app={app} messageId="m" /></MockHost> : null
}

let next = 0
const id = (name: string) => `${name}-${++next}`

const meta = {
  title: 'Chat/SuperOne/Portable MCP App',
  component: Preview,
  parameters: { layout: 'padded' },
  decorators: [(Story, context) => (
    <PortableTurnContext.Provider value={{ scheme: context.globals.theme === 'light' ? 'light' : 'dark', pendingPermission: null, mcpIcons: {}, projectPath: null }}>
      <div style={{ width: context.args.width, colorScheme: context.globals.theme === 'light' ? 'light' : 'dark' }}><Story /></div>
    </PortableTurnContext.Provider>
  )],
  args: { app: attachment(id('live')), arrival: 'live', mode: 'ok', width: 390 },
} satisfies Meta<typeof Preview>

export default meta
type Story = StoryObj<typeof meta>

/** Next page asks for approval once (Always Allow remembers it); the model-only button is refused by the host. */
export const Live: Story = { name: 'Live · app-only paging, denied model-only call' }

export const Loading: Story = { name: 'Loading · host has not answered', args: { app: attachment(id('slow')), mode: 'slow' } }

export const LoadFailed: Story = { name: 'Load failed · retry', args: { app: attachment(id('fails')), mode: 'fails' } }

export const AuthRequired: Story = { name: 'Auth required · sign in on the desktop', args: { app: attachment(id('auth')), mode: 'auth' } }

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
