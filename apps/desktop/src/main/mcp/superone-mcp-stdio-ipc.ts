import { randomUUID } from 'crypto'
import { chmodSync, existsSync, mkdirSync, unlinkSync } from 'fs'
import net, { type Server, type Socket } from 'net'
import { dirname, join } from 'path'
import { app } from 'electron'
import log from '../logger'
import { setToolSyncCallbacks } from './superone-mcp-server'
import { executeSuperoneMcpTool, listSuperoneMcpTools } from './superone-mcp-tool-surface'
import { setSuperoneMcpBridgeRuntime } from './superone-mcp-stdio-state'

type RequestId = string | number

interface IpcClient {
  socket: Socket
  buffer: string
  projectDir: string | null
}

interface IpcState {
  server: Server
  endpoint: string
  token: string
  clients: Set<IpcClient>
}

let state: IpcState | null = null

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readRequestId(value: unknown): RequestId | null {
  return typeof value === 'string' || typeof value === 'number' ? value : null
}

function writeMessage(socket: Socket, message: Record<string, unknown>): void {
  socket.write(`${JSON.stringify(message)}\n`)
}

function socketEndpoint(): string {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\superone-mcp-${process.pid}-${randomUUID()}`
  }
  return join(app.getPath('userData'), `superone-mcp-${process.pid}.sock`)
}

function bridgeScriptPath(): string {
  return join(__dirname, 'superone-mcp-stdio-bridge.js')
}

function prepareEndpoint(endpoint: string): void {
  if (process.platform === 'win32') return
  mkdirSync(dirname(endpoint), { recursive: true })
  if (existsSync(endpoint)) unlinkSync(endpoint)
}

async function handleRequest(client: IpcClient, raw: unknown): Promise<void> {
  const rec = readRecord(raw)
  if (!rec) return
  const id = readRequestId(rec.id)
  const method = readString(rec.method)
  const token = readString(rec.token)
  const params = readRecord(rec.params) ?? {}

  if (id === null || !method) return

  try {
    if (!state || token !== state.token) {
      throw new Error('Unauthorized SuperOne MCP bridge request')
    }

    if (method === 'tools/list') {
      const projectDir = readString(params.projectDir)
      if (!projectDir) throw new Error('Missing projectDir')
      client.projectDir = projectDir
      writeMessage(client.socket, { id, result: { tools: listSuperoneMcpTools(projectDir) } })
      return
    }

    if (method === 'tools/call') {
      const projectDir = readString(params.projectDir)
      const toolName = readString(params.name)
      if (!projectDir) throw new Error('Missing projectDir')
      if (!toolName) throw new Error('Missing tool name')
      const args = readRecord(params.arguments) ?? {}
      const result = await executeSuperoneMcpTool(projectDir, toolName, args)
      writeMessage(client.socket, { id, result })
      return
    }

    throw new Error(`Unknown SuperOne MCP bridge method: ${method}`)
  } catch (err) {
    writeMessage(client.socket, {
      id,
      error: { message: err instanceof Error ? err.message : String(err) },
    })
  }
}

function handleSocket(socket: Socket): void {
  if (!state) {
    socket.destroy()
    return
  }

  const client: IpcClient = { socket, buffer: '', projectDir: null }
  state.clients.add(client)
  socket.setEncoding('utf8')

  socket.on('data', (chunk: string) => {
    client.buffer += chunk
    let index = client.buffer.indexOf('\n')
    while (index >= 0) {
      const line = client.buffer.slice(0, index).trim()
      client.buffer = client.buffer.slice(index + 1)
      if (line) {
        try {
          void handleRequest(client, JSON.parse(line))
        } catch (err) {
          log.warn('[mcp-stdio-ipc] invalid bridge message: %s', err instanceof Error ? err.message : String(err))
        }
      }
      index = client.buffer.indexOf('\n')
    }
  })

  socket.on('close', () => {
    state?.clients.delete(client)
  })
  socket.on('error', (err) => {
    log.warn('[mcp-stdio-ipc] socket error: %s', err instanceof Error ? err.message : String(err))
  })
}

function notifyToolsChanged(projectDir: string): void {
  if (!state) return
  for (const client of state.clients) {
    if (client.projectDir !== projectDir) continue
    writeMessage(client.socket, { method: 'tools/changed', params: { projectDir } })
  }
}

export async function startSuperoneMcpStdioBridge(): Promise<void> {
  if (state) return

  const endpoint = socketEndpoint()
  const token = randomUUID()
  prepareEndpoint(endpoint)

  const server = net.createServer(handleSocket)
  const clients = new Set<IpcClient>()
  state = { server, endpoint, token, clients }

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(endpoint, () => {
        server.off('error', reject)
        resolve()
      })
    })
    if (process.platform !== 'win32') {
      chmodSync(endpoint, 0o600)
    }
  } catch (err) {
    state = null
    throw err
  }

  setSuperoneMcpBridgeRuntime({ endpoint, token, bridgeScriptPath: bridgeScriptPath() })
  setToolSyncCallbacks({ toolsChanged: notifyToolsChanged })
  server.on('error', (err) => {
    log.error('[mcp-stdio-ipc] server error:', err)
  })
  log.info('[mcp-stdio-ipc] listening on %s', endpoint)
}

export function stopSuperoneMcpStdioBridge(): void {
  const current = state
  setToolSyncCallbacks(null)
  setSuperoneMcpBridgeRuntime(null)
  state = null
  if (!current) return

  for (const client of current.clients) {
    client.socket.destroy()
  }
  current.clients.clear()
  current.server.close()

  if (process.platform !== 'win32') {
    try {
      unlinkSync(current.endpoint)
    } catch {}
  }
}
