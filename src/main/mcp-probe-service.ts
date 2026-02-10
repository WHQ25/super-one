import { join } from 'path'
import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import type { McpServerConfig, McpServerMeta } from '../shared/agent-types'

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

function writeCache(cache: Record<string, McpServerMeta>): void {
  writeFileSync(getCachePath(), JSON.stringify(cache, null, 2))
}

async function probeOne(config: McpServerConfig): Promise<McpServerMeta | null> {
  const client = new Client({ name: 'superpm-probe', version: '1.0.0' })

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
    return null
  }

  try {
    await Promise.race([
      client.connect(transport),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 10_000)),
    ])

    const info = client.getServerVersion()

    // Also fetch tools list for descriptions
    let tools: McpServerMeta['tools']
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
      // tools list optional
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
      tools,
    }

    await client.close()
    return meta
  } catch {
    try { await client.close() } catch { /* ignore */ }
    return null
  }
}

export async function probeMcpServers(configs: McpServerConfig[]): Promise<Record<string, McpServerMeta>> {
  const cache = readCache()
  const toProbe = configs.filter((c) => !c.disabled && !cache[c.name])

  const results = await Promise.allSettled(
    toProbe.map(async (config) => {
      const meta = await probeOne(config)
      if (meta) cache[config.name] = meta
    })
  )

  // Only write cache if we got new results
  if (results.some((r) => r.status === 'fulfilled')) {
    writeCache(cache)
  }

  return cache
}

export function getCachedMcpMeta(): Record<string, McpServerMeta> {
  return readCache()
}
