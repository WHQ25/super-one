import { join } from 'path'
import { homedir } from 'os'
import { readFileSync } from 'fs'
import { writeFile, mkdir } from 'fs/promises'
import { parse, stringify } from 'smol-toml'
import log from '../logger'

function readToml(filePath: string): Record<string, unknown> | null {
  try {
    return parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>
  } catch {
    return null
  }
}

export async function writeCodexMcpConfig(port: number): Promise<void> {
  const codexDir = join(homedir(), '.codex')
  const configPath = join(codexDir, 'config.toml')

  await mkdir(codexDir, { recursive: true })

  const parsed = readToml(configPath) ?? {}
  const mcpServers = (parsed.mcp_servers ?? {}) as Record<string, unknown>
  mcpServers.superone = { url: `http://127.0.0.1:${port}/mcp` }
  parsed.mcp_servers = mcpServers

  await writeFile(configPath, stringify(parsed), 'utf-8')
  log.info('[codex-mcp-config] wrote %s (port=%d)', configPath, port)
}

export async function removeCodexMcpConfig(): Promise<void> {
  const configPath = join(homedir(), '.codex', 'config.toml')

  const parsed = readToml(configPath)
  if (!parsed) return

  const mcpServers = parsed.mcp_servers as Record<string, unknown> | undefined
  if (!mcpServers?.superone) return

  delete mcpServers.superone
  if (Object.keys(mcpServers).length === 0) {
    delete parsed.mcp_servers
  }

  await writeFile(configPath, stringify(parsed), 'utf-8')
  log.info('[codex-mcp-config] removed superone from %s', configPath)
}
