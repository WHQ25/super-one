import net, { type Socket } from 'net'
import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { registerWidgetTools } from '../generative-ui/mcp-server'
import { jsonSchemaToZodShape } from './json-schema-zod'
import { BUILT_IN_SUPERONE_TOOL_DEFS } from './superone-mcp-builtin-defs'
import {
  SUPERONE_MCP_IPC_ENDPOINT_ENV,
  SUPERONE_MCP_IPC_TOKEN_ENV,
  SUPERONE_MCP_SESSION_ID_ENV,
} from './superone-mcp-stdio-env'
import { wireBridgeShutdown } from './superone-mcp-stdio-shutdown'
import { startBridgeRuntime } from './superone-mcp-stdio-startup'
import type { SuperoneMcpToolDescriptor } from './superone-mcp-types'

type RequestId = number

interface IpcRequest {
  id: RequestId
  method: string
  token: string
  params: Record<string, unknown>
}

interface IpcResponse {
  id?: RequestId
  result?: unknown
  error?: { message?: string }
  method?: string
  params?: Record<string, unknown>
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface SuperoneMcpToolResult {
  content: Array<{ type: 'text'; text: string }>
  [key: string]: unknown
}

class SuperoneIpcClient {
  private socket: Socket | null = null
  private buffer = ''
  private seq = 1
  private readonly pending = new Map<RequestId, PendingRequest>()
  onToolsChanged: (() => void) | null = null
  onClose: (() => void) | null = null

  constructor(
    private readonly endpoint: string,
    private readonly token: string,
    private readonly sessionId: string,
  ) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.endpoint)
      this.socket = socket
      socket.setEncoding('utf8')
      socket.once('connect', resolve)
      socket.once('error', reject)
      socket.on('data', (chunk: string) => this.handleData(chunk))
      socket.on('close', () => {
        this.rejectAll(new Error('SuperOne MCP bridge connection closed'))
        this.onClose?.()
      })
      socket.on('error', (err) => this.rejectAll(err instanceof Error ? err : new Error(String(err))))
    })
  }

  listTools(): Promise<SuperoneMcpToolDescriptor[]> {
    return this.request<{ tools: SuperoneMcpToolDescriptor[] }>('tools/list', {
      sessionId: this.sessionId,
    }).then((result) => Array.isArray(result.tools) ? result.tools : [])
  }

  callTool(name: string, args: Record<string, unknown>): Promise<SuperoneMcpToolResult> {
    return this.request<SuperoneMcpToolResult>('tools/call', {
      sessionId: this.sessionId,
      name,
      arguments: args,
    })
  }

  private request<T>(method: string, params: Record<string, unknown>): Promise<T> {
    if (!this.socket) return Promise.reject(new Error('SuperOne MCP bridge is not connected'))
    const id = this.seq++
    const payload: IpcRequest = { id, method, token: this.token, params }
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`SuperOne MCP bridge request timed out: ${method}`))
      }, 65_000)
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      })
      this.socket!.write(`${JSON.stringify(payload)}\n`)
    })
  }

  private handleData(chunk: string): void {
    this.buffer += chunk
    let index = this.buffer.indexOf('\n')
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim()
      this.buffer = this.buffer.slice(index + 1)
      if (line) {
        try {
          this.handleMessage(JSON.parse(line) as IpcResponse)
        } catch (err) {
          console.error('[superone-mcp-stdio-bridge] invalid ipc message:', err)
        }
      }
      index = this.buffer.indexOf('\n')
    }
  }

  private handleMessage(message: IpcResponse): void {
    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(message.id)
      if (message.error) {
        pending.reject(new Error(message.error.message ?? 'SuperOne MCP bridge request failed'))
      } else {
        pending.resolve(message.result)
      }
      return
    }

    if (message.method === 'tools/changed') {
      this.onToolsChanged?.()
    }
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(error)
      this.pending.delete(id)
    }
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function toolSignature(tool: SuperoneMcpToolDescriptor): string {
  return JSON.stringify([tool.description, tool.inputSchema, tool._meta ?? null])
}

async function main(): Promise<void> {
  const sessionId = requiredEnv(SUPERONE_MCP_SESSION_ID_ENV)
  // Do NOT set `process.title` here. On macOS it calls into LaunchServices to
  // register the process as an app, which is safe when we control the spawn, but
  // this process is exec'd by Codex's/ACP's/OpenCode's own process launcher — a
  // path we don't control. Observed regression: it caused a perpetually bouncing
  // Dock icon (each backend tears down/respawns this bridge per turn, and each
  // spawn re-registers). Known upstream pattern, no clean fix exists:
  // https://github.com/anthropics/claude-code/issues/1912
  // https://forum.cursor.com/t/floating-node-exec-icon-shows-in-dock-when-running-cursor-on-macos-15-beta/102931
  //
  // In packaged mode, resolve-cli spawns "SuperOne MCP Helper" with
  // ELECTRON_RUN_AS_NODE. Its executable basename intentionally retains the
  // required " Helper" suffix so Electron resolves ICU through the helper path.
  const ipc = new SuperoneIpcClient(
    requiredEnv(SUPERONE_MCP_IPC_ENDPOINT_ENV),
    requiredEnv(SUPERONE_MCP_IPC_TOKEN_ENV),
    sessionId,
  )

  const server = new McpServer({ name: 'superone', version: '1.0.0' })
  registerWidgetTools(server, { skipWidgetGate: true })

  const registeredTools = new Map<string, RegisteredTool>()
  const toolSignatures = new Map<string, string>()
  let connected = false

  const registerTool = (tool: SuperoneMcpToolDescriptor) => {
    const registered = server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: jsonSchemaToZodShape(tool.inputSchema),
        ...(tool._meta ? { _meta: tool._meta } : {}),
      },
      async (args: Record<string, unknown>) => {
        try {
          return await ipc.callTool(tool.name, args)
        } catch (err) {
          return { content: [{ type: 'text' as const, text: `[Error] ${err instanceof Error ? err.message : String(err)}` }] }
        }
      },
    )
    registeredTools.set(tool.name, registered)
    toolSignatures.set(tool.name, toolSignature(tool))
  }

  const refreshTools = async (notify: boolean) => {
    const tools = await ipc.listTools()
    const nextNames = new Set(tools.map((tool) => tool.name))

    for (const [name, tool] of registeredTools) {
      if (!nextNames.has(name)) {
        tool.remove()
        registeredTools.delete(name)
        toolSignatures.delete(name)
      }
    }

    for (const tool of tools) {
      const signature = toolSignature(tool)
      const existing = registeredTools.get(tool.name)
      if (existing && toolSignatures.get(tool.name) === signature) continue
      if (existing) existing.remove()
      registerTool(tool)
    }

    if (notify && connected) {
      await server.sendToolListChanged()
    }
  }

  ipc.onToolsChanged = () => {
    refreshTools(true).catch((err) => {
      console.error('[superone-mcp-stdio-bridge] failed to refresh tools:', err)
    })
  }

  // Synchronous floor: register the static built-in tool defs before the stdio
  // transport connects. Codex snapshots `tools/list` once at startup and never
  // re-lists on `tools/list_changed`, so the snapshot must never be empty — even
  // if the IPC channel to the main process is briefly unavailable. App tools are
  // layered on top once IPC connects (refreshTools dedupes by signature).
  for (const def of BUILT_IN_SUPERONE_TOOL_DEFS) registerTool(def)

  const transport = new StdioServerTransport()
  await startBridgeRuntime({
    connect: () => ipc.connect(),
    loadTools: () => refreshTools(false),
    connectStdio: async () => {
      await server.connect(transport)
      connected = true
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: (message) => console.error(`[superone-mcp-stdio-bridge] ${message}`),
  })

  wireBridgeShutdown({ stdin: process.stdin, transport, ipc, exit: () => process.exit(0) })
}

main().catch((err) => {
  console.error('[superone-mcp-stdio-bridge] startup failed:', err)
  process.exit(1)
})
