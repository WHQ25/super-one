import { join } from 'path'
import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import type { McpLibraryEntry, McpServerConfig, McpServerMeta } from '@superone/shared/agent-types'

const LIBRARY_FILE = 'mcp-library.json'

function getLibraryPath(): string {
  return join(app.getPath('userData'), LIBRARY_FILE)
}

function readLibrary(): Record<string, McpLibraryEntry> {
  const filePath = getLibraryPath()
  if (!existsSync(filePath)) return {}
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch {
    return {}
  }
}

function writeLibrary(library: Record<string, McpLibraryEntry>): void {
  writeFileSync(getLibraryPath(), JSON.stringify(library, null, 2))
}

/**
 * Auto-backup successfully probed MCP servers to the library.
 * Only backs up servers that have meta (i.e. were successfully probed).
 * Preserves existing icon data — never overwrites.
 */
export function backupMcpServers(
  configs: McpServerConfig[],
  meta: Record<string, McpServerMeta>,
): void {
  const library = readLibrary()
  let changed = false

  for (const config of configs) {
    if (config.disabled) continue
    const serverMeta = meta[config.name]
    if (!serverMeta) continue // only backup servers with successful probe

    const existing = library[config.name]

    const entry: McpLibraryEntry = {
      name: config.name,
      type: config.type,
      command: config.command,
      args: config.args,
      env: config.env,
      url: config.url,
      headers: config.headers,
      description: serverMeta.description,
      icons: existing?.icons ?? serverMeta.icons, // preserve existing icons
      savedAt: existing?.savedAt ?? new Date().toISOString(),
    }

    library[config.name] = entry
    changed = true
  }

  if (changed) writeLibrary(library)
}

export function listLibrary(): McpLibraryEntry[] {
  const library = readLibrary()
  return Object.values(library).sort((a, b) => a.name.localeCompare(b.name))
}

export function getLibraryEntry(name: string): McpLibraryEntry | undefined {
  return readLibrary()[name]
}

export function deleteLibraryEntry(name: string): void {
  const library = readLibrary()
  delete library[name]
  writeLibrary(library)
}

export interface AddBundleLibraryEntryInput {
  name: string
  bundleVersion: string
  command: string
  args: string[]
  env: Record<string, string>
  description?: string
  iconDataUrl?: string
}

export function addBundleLibraryEntry(input: AddBundleLibraryEntryInput): void {
  const library = readLibrary()
  const existing = library[input.name]

  const icons: McpLibraryEntry['icons'] = input.iconDataUrl
    ? [{ src: input.iconDataUrl }]
    : existing?.icons

  library[input.name] = {
    name: input.name,
    type: 'stdio',
    command: input.command,
    args: input.args,
    env: input.env,
    description: input.description ?? existing?.description,
    icons,
    savedAt: existing?.savedAt ?? new Date().toISOString(),
    bundleId: `${input.name}@${input.bundleVersion}`,
    bundleVersion: input.bundleVersion,
  }
  writeLibrary(library)
}
