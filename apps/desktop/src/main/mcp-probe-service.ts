import { join } from 'path'
import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import type { McpCheckResult, McpServerConfig, McpServerInfo, McpServerMeta, McpToolInfo } from '@superone/shared/agent-types'

const CACHE_FILE = 'mcp-server-meta-cache.json'

function getCachePath(): string {
  return join(app.getPath('userData'), CACHE_FILE)
}

function readCache(): Record<string, McpServerMeta> {
  const filePath = getCachePath()
  if (!existsSync(filePath)) return {}
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch {
    return {}
  }
}

export function readMcpMetaCache(): Record<string, McpServerMeta> {
  return readCache()
}

function writeCache(cache: Record<string, McpServerMeta>): void {
  writeFileSync(getCachePath(), JSON.stringify(cache, null, 2))
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return String(error)
}

export function isAuthError(config: McpServerConfig, message: string): boolean {
  if (config.type !== 'http' && config.type !== 'sse') return false
  return /(^|[^0-9])(401|403)([^0-9]|$)|unauthorized|forbidden|oauth|authorization/i.test(message)
}

async function checkOne(config: McpServerConfig): Promise<{ status: McpServerInfo; meta?: McpServerMeta }> {
  if (config.disabled) {
    return {
      status: {
        name: config.name,
        status: 'disabled',
      },
    }
  }

  const client = new Client({ name: 'superone-probe', version: '1.0.0' })

  let transport: StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport
  if (config.type === 'sse' && config.url) {
    transport = new SSEClientTransport(new URL(config.url), {
      requestInit: config.headers
        ? { headers: config.headers }
        : undefined,
    })
  } else if (config.type === 'http' && config.url) {
    transport = new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: config.headers
        ? { headers: config.headers }
        : undefined,
    })
  } else if (config.command) {
    transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: { ...process.env, ...(config.env ?? {}) } as Record<string, string>,
    })
  } else {
    return {
      status: {
        name: config.name,
        status: 'failed',
        error: 'Invalid MCP configuration',
      },
    }
  }

  try {
    await Promise.race([
      client.connect(transport),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 10_000)),
    ])

    const info = client.getServerVersion()

    // Also fetch tools list for descriptions
    let tools: McpToolInfo[] = []
    try {
      const toolsResult = await Promise.race([
        client.listTools(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5_000)),
      ])
      tools = toolsResult.tools.map((t) => ({
        name: t.name,
        description: t.description,
      }))
    } catch {
      // tools list optional; server can still be connected
    }

    const meta: McpServerMeta = {
      name: config.name,
      version: info?.version,
      description: info?.description,
      websiteUrl: info?.websiteUrl,
      icons: info?.icons?.map((icon) => ({
        src: icon.src,
        mimeType: icon.mimeType,
        sizes: icon.sizes,
        theme: icon.theme,
      })),
      tools: tools.length > 0 ? tools : undefined,
    }

    await client.close()
    return {
      status: {
        name: config.name,
        status: 'connected',
        toolCount: tools.length,
        tools,
      },
      meta,
    }
  } catch (error) {
    const message = toErrorMessage(error)
    const status: McpServerInfo['status'] = isAuthError(config, message) ? 'needs-auth' : 'failed'
    try { await client.close() } catch { /* ignore */ }
    return {
      status: {
        name: config.name,
        status,
        error: message,
      },
    }
  }
}

export async function checkMcpServers(configs: McpServerConfig[]): Promise<McpCheckResult> {
  const cache = readCache()
  const checks = await Promise.all(configs.map(async (config) => checkOne(config)))

  const status: McpServerInfo[] = []
  const meta: Record<string, McpServerMeta> = {}
  let cacheChanged = false

  for (let i = 0; i < configs.length; i++) {
    const config = configs[i]
    const check = checks[i]
    status.push({
      ...check.status,
      scope: config.scope,
    })

    if (check.meta) {
      meta[config.name] = check.meta
      if (JSON.stringify(cache[config.name]) !== JSON.stringify(check.meta)) {
        cache[config.name] = check.meta
        cacheChanged = true
      }
      continue
    }

    if (cache[config.name]) {
      meta[config.name] = cache[config.name]
    }
  }

  if (cacheChanged) {
    writeCache(cache)
  }

  return { status, meta }
}

