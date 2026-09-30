/**
 * MCP Apps fixture server: one server that exercises every host-facing part of
 * `io.modelcontextprotocol/ui` — tool UI metadata, visibility, the `ui://`
 * resource, structured and private results, errors, cancellation and auth.
 *
 * Run standalone with Node's type stripping (Codex / Claude / gateway spikes):
 *   node apps/desktop/src/test/fixtures/mcp-apps/fixture-server.ts --stdio
 *   node apps/desktop/src/test/fixtures/mcp-apps/fixture-server.ts --http 7331 [--token secret]
 * `MCP_APPS_FIXTURE_LOG=<file>` appends every inbound JSON-RPC message as JSONL,
 * so a spike can check what the harness really sent (e.g. `initialize`).
 *
 * Only erasable TypeScript syntax: Node runs this file without a build step.
 */
import { appendFileSync, readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { z } from 'zod'

export const FIXTURE_SERVER_NAME = 'mcp-apps-fixture'
export const FIXTURE_VIEW_URI = 'ui://fixture/items.html'
export const FIXTURE_LEGACY_VIEW_URI = 'ui://fixture/legacy.html'
export const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app'
export const FIXTURE_PRIVATE_META_KEY = 'fixture/private'

const PAGE_SIZE = 3
const ALL_ITEMS = Array.from({ length: 12 }, (_, i) => `item-${i + 1}`)

const VIEW_HTML = readFileSync(fileURLToPath(new URL('./fixture-view.html', import.meta.url)), 'utf8')

/** Resource `_meta.ui`, declared on both the list entry and the read content (content wins). */
const VIEW_RESOURCE_UI = {
  csp: { connectDomains: [], resourceDomains: [] },
  prefersBorder: true,
}

const itemsOutput = { items: z.array(z.string()), page: z.number(), pageCount: z.number() }

function pageResult(page: number, visibility: string) {
  const pageCount = Math.ceil(ALL_ITEMS.length / PAGE_SIZE)
  const clamped = Math.min(Math.max(1, page), pageCount)
  const items = ALL_ITEMS.slice((clamped - 1) * PAGE_SIZE, clamped * PAGE_SIZE)
  return {
    content: [{ type: 'text' as const, text: `Page ${clamped}/${pageCount}: ${items.join(', ')}` }],
    structuredContent: { items, page: clamped, pageCount },
    // Private to the View: a host must never forward this to the model.
    _meta: { [FIXTURE_PRIVATE_META_KEY]: { visibility, token: `private-${clamped}` } },
  }
}

export interface FixtureServerHandle {
  server: McpServer
  /** Raw params of the client's `initialize` request, once received. */
  initializeParams(): unknown
  /** Feed every inbound JSON-RPC message here (see `observeTransport`). */
  recordInbound(message: unknown): void
}

export function createFixtureServer(): FixtureServerHandle {
  const server = new McpServer({ name: FIXTURE_SERVER_NAME, version: '1.0.0' })
  let initParams: unknown

  // No `visibility` → ["model", "app"]: the model calls it and the View re-renders it.
  server.registerTool(
    'fixture_list_items',
    {
      description: 'List fixture items one page at a time and show them in an interactive view.',
      inputSchema: { page: z.number().int().min(1).optional() },
      outputSchema: itemsOutput,
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: FIXTURE_VIEW_URI } },
    },
    async ({ page }) => pageResult(page ?? 1, 'model+app'),
  )

  server.registerTool(
    'fixture_next_page',
    {
      description: 'App-only pagination for the fixture view. Must never reach the model.',
      inputSchema: { page: z.number().int().min(1) },
      outputSchema: itemsOutput,
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: FIXTURE_VIEW_URI, visibility: ['app'] } },
    },
    async ({ page }) => pageResult(page, 'app'),
  )

  server.registerTool(
    'fixture_model_echo',
    {
      description: 'Model-only echo. A View calling it must be rejected by the host.',
      inputSchema: { text: z.string() },
      _meta: { ui: { visibility: ['model'] } },
    },
    async ({ text }) => ({ content: [{ type: 'text' as const, text: `echo: ${text}` }] }),
  )

  // Deprecated flat key only, to exercise the host's read fallback.
  server.registerTool(
    'fixture_legacy_ui',
    {
      description: 'Tool that declares its view with the deprecated flat _meta key.',
      _meta: { 'ui/resourceUri': FIXTURE_LEGACY_VIEW_URI },
    },
    async () => ({ content: [{ type: 'text' as const, text: 'legacy view tool ran' }] }),
  )

  server.registerTool(
    'fixture_fail',
    { description: 'Always completes with isError: a completed failure, not an unknown outcome.' },
    async () => ({ isError: true, content: [{ type: 'text' as const, text: 'fixture failure' }] }),
  )

  server.registerTool(
    'fixture_slow',
    {
      description: 'Waits `ms` milliseconds unless cancelled. Has side effects (readOnlyHint false).',
      inputSchema: { ms: z.number().int().min(0).max(60_000) },
      annotations: { readOnlyHint: false },
    },
    async ({ ms }, extra) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, ms)
        extra.signal.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(new Error('cancelled'))
        })
      })
      return { content: [{ type: 'text' as const, text: `slept ${ms}ms` }] }
    },
  )

  server.registerTool(
    'fixture_client_info',
    { description: 'Report the initialize params this server received from its client.' },
    async () => ({ content: [{ type: 'text' as const, text: JSON.stringify(initParams ?? null) }] }),
  )

  for (const [name, uri] of [
    ['items-view', FIXTURE_VIEW_URI],
    ['legacy-view', FIXTURE_LEGACY_VIEW_URI],
  ] as const) {
    server.registerResource(
      name,
      uri,
      { mimeType: MCP_APP_MIME_TYPE, _meta: { ui: VIEW_RESOURCE_UI } },
      async () => ({
        contents: [{ uri, mimeType: MCP_APP_MIME_TYPE, text: VIEW_HTML, _meta: { ui: VIEW_RESOURCE_UI } }],
      }),
    )
  }

  return {
    server,
    initializeParams: () => initParams,
    recordInbound: (message) => {
      const m = message as { method?: string; params?: unknown }
      if (m.method === 'initialize') initParams = m.params
    },
  }
}

/** Wraps a connected transport so every inbound message is recorded before the SDK sees it. */
export function observeTransport(transport: Transport, handle: FixtureServerHandle): void {
  const inner = transport.onmessage
  const log = process.env.MCP_APPS_FIXTURE_LOG
  transport.onmessage = (message, extra) => {
    handle.recordInbound(message)
    if (log) appendFileSync(log, `${JSON.stringify({ at: new Date().toISOString(), message })}\n`)
    inner?.(message, extra)
  }
}

export interface FixtureHttpServer {
  url: string
  close(): Promise<void>
}

/**
 * Streamable HTTP, one MCP session per `mcp-session-id`. With `token`, requests
 * without `Authorization: Bearer <token>` get 401 + `WWW-Authenticate`.
 */
export async function startFixtureHttpServer(opts: { port?: number; token?: string } = {}): Promise<FixtureHttpServer> {
  const sessions = new Map<string, StreamableHTTPServerTransport>()
  const http: Server = createServer(async (req, res) => {
    if (!req.url?.startsWith('/mcp')) {
      res.writeHead(404).end()
      return
    }
    if (opts.token && req.headers.authorization !== `Bearer ${opts.token}`) {
      const { port } = http.address() as { port: number }
      res
        .writeHead(401, {
          'WWW-Authenticate': `Bearer resource_metadata="http://127.0.0.1:${port}/.well-known/oauth-protected-resource"`,
        })
        .end()
      return
    }
    const sessionId = req.headers['mcp-session-id']
    let transport = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined
    if (!transport) {
      const handle = createFixtureServer()
      const created = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => sessions.set(id, created),
      })
      created.onclose = () => {
        if (created.sessionId) sessions.delete(created.sessionId)
      }
      await handle.server.connect(created)
      observeTransport(created, handle)
      transport = created
    }
    await transport.handleRequest(req, res, await readJsonBody(req))
  })
  await new Promise<void>((resolve) => http.listen(opts.port ?? 0, '127.0.0.1', resolve))
  const { port } = http.address() as { port: number }
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    close: async () => {
      await Promise.all([...sessions.values()].map((t) => t.close()))
      await new Promise<void>((resolve) => http.close(() => resolve()))
    },
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  if (req.method !== 'POST') return undefined
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined
}

async function main(argv: string[]): Promise<void> {
  const flag = (name: string) => {
    const i = argv.indexOf(name)
    return i >= 0 ? argv[i + 1] : undefined
  }
  if (argv.includes('--http')) {
    const server = await startFixtureHttpServer({ port: Number(flag('--http') ?? 0), token: flag('--token') })
    process.stderr.write(`${FIXTURE_SERVER_NAME} listening on ${server.url}\n`)
    return
  }
  const handle = createFixtureServer()
  const transport = new StdioServerTransport()
  await handle.server.connect(transport)
  observeTransport(transport, handle)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main(process.argv.slice(2))
}
