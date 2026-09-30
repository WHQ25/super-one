import { afterEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import {
  FIXTURE_LEGACY_VIEW_URI,
  FIXTURE_PRIVATE_META_KEY,
  FIXTURE_VIEW_URI,
  MCP_APP_MIME_TYPE,
  createFixtureServer,
  observeTransport,
} from './fixture-server'

const UI_EXTENSION = { 'io.modelcontextprotocol/ui': { mimeTypes: [MCP_APP_MIME_TYPE] } }

async function connect() {
  const handle = createFixtureServer()
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await handle.server.connect(serverSide)
  observeTransport(serverSide, handle)
  const client = new Client(
    { name: 'fixture-test', version: '1.0.0' },
    { capabilities: { extensions: UI_EXTENSION } as never },
  )
  await client.connect(clientSide)
  return { client, handle }
}

let open: Client | undefined
afterEach(async () => {
  await open?.close()
  open = undefined
})

describe('MCP Apps fixture server', () => {
  it('records the raw initialize capabilities the client advertised', async () => {
    const { client, handle } = await connect()
    open = client
    const params = handle.initializeParams() as { capabilities: { extensions?: unknown } }
    expect(params.capabilities.extensions).toEqual(UI_EXTENSION)
  })

  it('declares tool UI metadata and visibility, including the legacy flat key', async () => {
    const { client } = await connect()
    open = client
    const tools = new Map((await client.listTools()).tools.map((t) => [t.name, t]))
    expect(tools.get('fixture_list_items')?._meta).toEqual({ ui: { resourceUri: FIXTURE_VIEW_URI } })
    expect(tools.get('fixture_next_page')?._meta).toMatchObject({ ui: { visibility: ['app'] } })
    expect(tools.get('fixture_model_echo')?._meta).toMatchObject({ ui: { visibility: ['model'] } })
    expect(tools.get('fixture_legacy_ui')?._meta).toEqual({ 'ui/resourceUri': FIXTURE_LEGACY_VIEW_URI })
    expect(tools.get('fixture_list_items')?.outputSchema).toBeDefined()
  })

  it('serves the View as an MCP App resource with UI metadata on list and content', async () => {
    const { client } = await connect()
    open = client
    const listed = (await client.listResources()).resources.find((r) => r.uri === FIXTURE_VIEW_URI)
    expect(listed).toMatchObject({ mimeType: MCP_APP_MIME_TYPE, _meta: { ui: { prefersBorder: true } } })
    const [content] = (await client.readResource({ uri: FIXTURE_VIEW_URI })).contents
    expect(content).toMatchObject({ mimeType: MCP_APP_MIME_TYPE, _meta: { ui: { csp: { connectDomains: [] } } } })
    expect(content && 'text' in content ? content.text : '').toContain('ui/initialize')
  })

  it('returns structured content with a private _meta, validated against outputSchema', async () => {
    const { client } = await connect()
    open = client
    const result = await client.callTool({ name: 'fixture_list_items', arguments: { page: 2 } })
    expect(result.structuredContent).toEqual({ items: ['item-4', 'item-5', 'item-6'], page: 2, pageCount: 4 })
    expect(result._meta).toMatchObject({ [FIXTURE_PRIVATE_META_KEY]: { token: 'private-2' } })
  })

  it('completes fixture_fail as a failure result, not a protocol error', async () => {
    const { client } = await connect()
    open = client
    const result = await client.callTool({ name: 'fixture_fail', arguments: {} })
    expect(result.isError).toBe(true)
  })

  it('stops fixture_slow when the call is cancelled', async () => {
    const { client } = await connect()
    open = client
    const controller = new AbortController()
    const call = client.callTool({ name: 'fixture_slow', arguments: { ms: 30_000 } }, undefined, {
      signal: controller.signal,
    })
    controller.abort()
    await expect(call).rejects.toThrow()
  })
})
