import { cdpSend } from './browser-cdp'
import { isSecureWebMcpOrigin, sanitizeWebMcpTool, type WebMcpTool } from './browser-webmcp'
import { ensureChromeCdpTarget } from './chrome-browser'
import { cdpTransportFor, chromeTabIdFromTarget, type CdpTransport } from './cdp-transport'

const DEFAULT_SETTLE_MS = 200
const DEFAULT_CALL_TIMEOUT_MS = 30_000

const LIST_EXPRESSION = `(async () => {
  const mc = document.modelContext
  const href = location.href
  if (!mc || typeof mc.getTools !== 'function') return { available: false, href }
  const tools = await mc.getTools()
  return {
    available: true,
    href,
    tools: (tools || []).map((tool) => ({
      name: tool && tool.name,
      title: (tool && tool.title) || '',
      description: (tool && tool.description) || '',
      inputSchema: tool && tool.inputSchema,
      annotations: (tool && tool.annotations) || null,
    })),
  }
})()`

export type ChromeWebMcpRead =
  | { available: false; reason: 'unsupported' | 'insecure'; origin?: string }
  | { available: true; origin: string; tools: WebMcpTool[] }

interface RawTool {
  frameId: string
  tool: WebMcpTool
}

interface WebMcpSession {
  mode: 'cdp' | 'page' | 'unsupported'
  topUrl: string
  rootFrameId: string
  frameUrls: Map<string, string>
  raw: RawTool[]
  unsub: () => void
  detachUnsub: () => void
}

const sessions = new Map<number, WebMcpSession>()

export function resetChromeWebMcpForTests(): void {
  for (const session of sessions.values()) {
    session.unsub()
    session.detachUnsub()
  }
  sessions.clear()
}

function domainMissing(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /webmcp/i.test(message) && /(wasn't found|was not found|not found|unknown|not supported)/i.test(message)
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

function schemaString(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value ?? { type: 'object' })
  } catch {
    return '{"type":"object"}'
  }
}

function normalizeTool(value: unknown): WebMcpTool | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const description = typeof raw.description === 'string' ? raw.description : ''
  return sanitizeWebMcpTool({ ...raw, description, inputSchema: schemaString(raw.inputSchema) })
}

function rememberTools(session: WebMcpSession, tools: unknown): void {
  if (!Array.isArray(tools)) return
  for (const value of tools) {
    if (!value || typeof value !== 'object') continue
    const raw = value as Record<string, unknown>
    const tool = normalizeTool(raw)
    const frameId = typeof raw.frameId === 'string' ? raw.frameId : ''
    if (!tool) continue
    const index = session.raw.findIndex((item) => item.tool.name === tool.name && item.frameId === frameId)
    if (index >= 0) session.raw[index] = { frameId, tool }
    else session.raw.push({ frameId, tool })
  }
}

function forgetTools(session: WebMcpSession, tools: unknown): void {
  if (!Array.isArray(tools)) return
  for (const value of tools) {
    if (!value || typeof value !== 'object') continue
    const raw = value as Record<string, unknown>
    const name = typeof raw.name === 'string' ? raw.name : ''
    const frameId = typeof raw.frameId === 'string' ? raw.frameId : ''
    session.raw = session.raw.filter((item) => item.tool.name !== name || item.frameId !== frameId)
  }
}

function openSession(webContentsId: number, transport: CdpTransport): WebMcpSession {
  const session: WebMcpSession = {
    mode: 'unsupported',
    topUrl: '',
    rootFrameId: '',
    frameUrls: new Map(),
    raw: [],
    unsub: () => {},
    detachUnsub: () => {},
  }
  session.unsub = transport.subscribe((method, params) => {
    const body = params as { tools?: unknown }
    if (method === 'WebMCP.toolsAdded') rememberTools(session, body.tools)
    if (method === 'WebMCP.toolsRemoved') forgetTools(session, body.tools)
  })
  session.detachUnsub = transport.onDetach(() => {
    session.unsub()
    sessions.delete(webContentsId)
  })
  sessions.set(webContentsId, session)
  return session
}

interface CdpFrame {
  id?: string
  url?: string
}

interface CdpFrameTree {
  frame?: CdpFrame
  childFrames?: CdpFrameTree[]
}

function walkFrames(node: CdpFrameTree | undefined, into: Map<string, string>, root: { id: string; url: string }): void {
  const frame = node?.frame
  if (frame?.id && typeof frame.url === 'string') {
    into.set(frame.id, frame.url)
    if (!root.id) {
      root.id = frame.id
      root.url = frame.url
    }
  }
  for (const child of node?.childFrames ?? []) walkFrames(child, into, root)
}

async function evaluate(webContentsId: number, expression: string): Promise<unknown> {
  const res = await cdpSend(webContentsId, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  }) as { result?: { value?: unknown }; exceptionDetails?: { text?: string; exception?: { description?: string } } }
  if (res?.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text || 'Page script failed')
  }
  return res?.result?.value
}

async function readTopUrl(webContentsId: number): Promise<string> {
  const value = await evaluate(webContentsId, 'location.href').catch(() => '')
  return typeof value === 'string' ? value : ''
}

async function applyFrameTree(webContentsId: number, session: WebMcpSession): Promise<void> {
  try {
    const tree = await cdpSend(webContentsId, 'Page.getFrameTree', {}) as { frameTree?: CdpFrameTree }
    const root = { id: '', url: '' }
    walkFrames(tree.frameTree, session.frameUrls, root)
    if (root.url) {
      session.rootFrameId = root.id
      session.topUrl = root.url
    }
  } catch {
    // The frame tree is how cross-frame tools are attributed. The top document is enough to decide
    // whether the tab is a secure context.
  }
  if (!session.topUrl) session.topUrl = await readTopUrl(webContentsId)
}

/** Tools a list would show. Cross-origin debugger hits stay out; the call path uses the same set. */
function listedTools(session: WebMcpSession): RawTool[] {
  const topOrigin = originOf(session.topUrl)
  const ranked = [...session.raw].sort((a, b) => {
    const aRoot = a.frameId === session.rootFrameId || a.frameId === '' ? 0 : 1
    const bRoot = b.frameId === session.rootFrameId || b.frameId === '' ? 0 : 1
    return aRoot - bRoot
  })
  const kept: RawTool[] = []
  const seen = new Set<string>()
  for (const item of ranked) {
    if (seen.has(item.tool.name)) continue
    const frameUrl = item.frameId ? session.frameUrls.get(item.frameId) : session.topUrl
    if (!frameUrl || !isSecureWebMcpOrigin(frameUrl)) continue
    const frameOrigin = originOf(frameUrl)
    if (session.mode === 'cdp' && frameOrigin && topOrigin && frameOrigin !== topOrigin) continue
    seen.add(item.tool.name)
    kept.push(item)
  }
  return kept
}

function present(session: WebMcpSession): ChromeWebMcpRead {
  const origin = originOf(session.topUrl) ?? undefined
  const withOrigin = origin ? { origin } : {}
  if (session.topUrl && !isSecureWebMcpOrigin(session.topUrl)) {
    return { available: false, reason: 'insecure', ...withOrigin }
  }
  if (session.mode === 'unsupported' || !session.topUrl) {
    return {
      available: false,
      reason: session.mode === 'unsupported' ? 'unsupported' : 'insecure',
      ...withOrigin,
    }
  }
  return { available: true, origin: origin || session.topUrl, tools: listedTools(session).map((item) => item.tool) }
}

async function pageToolSnapshot(webContentsId: number): Promise<{ available: boolean; href: string; tools: unknown[] }> {
  const value = await evaluate(webContentsId, LIST_EXPRESSION) as { available?: boolean; href?: string; tools?: unknown } | null
  return {
    available: value?.available === true,
    href: typeof value?.href === 'string' ? value.href : '',
    tools: Array.isArray(value?.tools) ? value.tools : [],
  }
}

function withTopFrame(tools: unknown[]): unknown[] {
  return tools.map((tool) => (
    tool && typeof tool === 'object' ? { ...(tool as Record<string, unknown>), frameId: '' } : tool
  ))
}

async function readFromPage(webContentsId: number, session: WebMcpSession): Promise<ChromeWebMcpRead> {
  const page = await pageToolSnapshot(webContentsId)
  session.topUrl = page.href || session.topUrl
  session.raw = []
  if (!page.available) {
    session.mode = 'unsupported'
    return present(session)
  }
  session.mode = 'page'
  session.rootFrameId = ''
  if (session.topUrl) session.frameUrls.set('', session.topUrl)
  rememberTools(session, withTopFrame(page.tools))
  return present(session)
}

/** Tools the top document is allowed to see, including iframe tools it was explicitly granted. */
async function mergeAuthorizedPageTools(webContentsId: number, session: WebMcpSession): Promise<void> {
  const page = await pageToolSnapshot(webContentsId).catch(() => null)
  if (!page?.available) return
  if (!session.topUrl && page.href) session.topUrl = page.href
  const known = new Set(session.raw.map((item) => item.tool.name))
  const extra = page.tools.filter((tool) => {
    const name = tool && typeof tool === 'object' ? (tool as { name?: unknown }).name : ''
    return typeof name === 'string' && !known.has(name)
  })
  rememberTools(session, withTopFrame(extra))
}

/**
 * List WebMCP tools on a Chrome tab.
 * The debugger domain sees every frame. When that domain is absent, the page's own
 * document.modelContext is read in the top document, which is the same call an extension agent makes.
 */
export async function readChromeWebMcp(webContentsId: number, opts?: { settleMs?: number }): Promise<ChromeWebMcpRead> {
  const tabId = chromeTabIdFromTarget(webContentsId)
  const transport = cdpTransportFor(webContentsId) ?? ensureChromeCdpTarget(tabId)
  let session = sessions.get(webContentsId)
  if (!session) session = openSession(webContentsId, transport)
  let enabledNow = false
  if (session.mode !== 'cdp') {
    try {
      await cdpSend(webContentsId, 'WebMCP.enable', {})
      session.mode = 'cdp'
      enabledNow = true
    } catch (err) {
      if (!domainMissing(err)) throw err
      return readFromPage(webContentsId, session)
    }
  }
  await applyFrameTree(webContentsId, session)
  if (enabledNow) await delay(opts?.settleMs ?? DEFAULT_SETTLE_MS)
  const missingFrame = session.raw.some((item) => item.frameId && !session.frameUrls.has(item.frameId))
  if (missingFrame) await applyFrameTree(webContentsId, session)
  await mergeAuthorizedPageTools(webContentsId, session)
  return present(session)
}

function callExpression(name: string, input: unknown): string {
  const request = JSON.stringify({ name, input })
  return `(async () => {
    const request = ${request}
    const mc = document.modelContext
    if (!mc || typeof mc.getTools !== 'function') return { available: false }
    const tools = await mc.getTools()
    const tool = (tools || []).find((item) => item && item.name === request.name)
    if (!tool) return { available: true, missing: true }
    try {
      let raw
      try {
        raw = await mc.executeTool(tool, request.input)
      } catch (err) {
        const message = String((err && err.message) || err)
        if (message.startsWith('Failed to parse input')) raw = await mc.executeTool(tool, JSON.stringify(request.input))
        else throw err
      }
      return { ok: true, output: typeof raw === 'string' ? raw : JSON.stringify(raw ?? null) }
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) }
    }
  })()`
}

function outputJson(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value ?? null)
  } catch {
    return 'null'
  }
}

interface ToolResponse {
  invocationId?: string
  status?: string
  output?: unknown
  errorText?: string
}

function listenForInvocation(transport: CdpTransport, timeoutMs: number): {
  promise: Promise<ToolResponse>
  arm: (invocationId: string) => void
  cancel: () => void
} {
  const buffered: ToolResponse[] = []
  let invocationId = ''
  let settled = false
  let resolveResponse: (body: ToolResponse) => void = () => {}
  let rejectResponse: (error: Error) => void = () => {}
  const promise = new Promise<ToolResponse>((resolve, reject) => {
    resolveResponse = resolve
    rejectResponse = reject
  })
  promise.catch(() => undefined)
  let unsub = (): void => {}
  const finish = (body: ToolResponse): void => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    unsub()
    resolveResponse(body)
  }
  const timer = setTimeout(() => {
    if (settled) return
    settled = true
    unsub()
    rejectResponse(new Error(`WebMCP invocation timed out after ${timeoutMs}ms`))
  }, timeoutMs)
  unsub = transport.subscribe((method, params) => {
    if (method !== 'WebMCP.toolResponded') return
    const body = params as ToolResponse
    if (invocationId && body.invocationId === invocationId) finish(body)
    else buffered.push(body)
  })
  return {
    promise,
    arm(id: string) {
      invocationId = id
      const early = buffered.find((body) => body.invocationId === id)
      if (early) finish(early)
    },
    cancel() {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unsub()
      rejectResponse(new Error('WebMCP invocation was cancelled'))
    },
  }
}

export async function callChromeWebMcpTool(
  webContentsId: number,
  name: string,
  input: Record<string, unknown>,
  opts?: { timeoutMs?: number },
): Promise<{ outputJson: string }> {
  const snap = await readChromeWebMcp(webContentsId, { settleMs: 0 })
  if (!snap.available) {
    throw new Error(snap.reason === 'insecure'
      ? 'WebMCP is only available on HTTPS or localhost.'
      : 'This Chrome does not expose WebMCP.')
  }
  const session = sessions.get(webContentsId)
  const transport = cdpTransportFor(webContentsId)
  if (!session || !transport) throw new Error('Chrome WebMCP is no longer attached')
  const tool = listedTools(session).find((item) => item.tool.name === name)
  if (!tool) throw new Error(`This page does not register a tool named "${name}".`)

  if (session.mode === 'cdp' && tool.frameId) {
    const listener = listenForInvocation(transport, opts?.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS)
    try {
      const started = await cdpSend(webContentsId, 'WebMCP.invokeTool', {
        frameId: tool.frameId,
        toolName: name,
        input,
      }) as { invocationId?: string }
      if (!started?.invocationId) throw new Error('WebMCP.invokeTool did not return an invocation id')
      listener.arm(started.invocationId)
      const result = await listener.promise
      if (result.status === 'Completed') return { outputJson: outputJson(result.output) }
      throw new Error(result.errorText || `WebMCP tool ${name} ${result.status || 'failed'}`)
    } catch (err) {
      listener.cancel()
      throw err
    }
  }

  const value = await evaluate(webContentsId, callExpression(name, input)) as { ok?: boolean; output?: string; error?: string; missing?: boolean; available?: boolean } | null
  if (!value || value.available === false) throw new Error('This Chrome does not expose WebMCP.')
  if (value.missing) throw new Error(`This page does not register a tool named "${name}".`)
  if (value.ok === false) throw new Error(value.error || 'WebMCP tool failed')
  return { outputJson: typeof value.output === 'string' ? value.output : 'null' }
}
