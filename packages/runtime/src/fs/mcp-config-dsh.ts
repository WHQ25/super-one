/**
 * DeepSeek Harness MCP config read/write.
 *
 * File: `$DSH_HOME/profiles/<profile>/cordis.patch.yml` (`$DSH_HOME` defaults to
 * `~/.dsh`) — dsh's own user patch layer, where an MCP server is one loader
 * entry naming `@deepseek-ai/dsh-mcp-client`. SuperOne extends dsh rather than
 * replacing it, so this reads and writes dsh's file directly and touches only
 * those entries; every other row, its comments, and its `!!js` expressions
 * round-trip untouched.
 *
 * dsh composes per deployment, not per workspace: there is no project-level
 * layer, so every server here is user scope.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir as osHomedir } from 'node:os'
import { isMap, isSeq, parseDocument, type Document, type YAMLMap, type YAMLSeq } from 'yaml'
import type { McpServerConfig, ResourceScope } from '@superone/shared/agent-types'

export interface DshMcpOptions {
  homeDir?: string
  dshHome?: string
  /** dsh profile whose patch layer is edited; the GUI profile by default. */
  dshProfile?: string
}

/** The plugin an MCP server entry mounts. */
const MCP_CLIENT_PACKAGE = '@deepseek-ai/dsh-mcp-client'
const DEFAULT_PROFILE = 'web'
const PATCH_FILENAME = 'cordis.patch.yml'

const NEW_FILE_HEADER = `# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; \`!!js\` expressions allowed).
`

function homeOf(opts?: DshMcpOptions): string {
  return opts?.homeDir ?? osHomedir()
}

function dshHomeOf(opts?: DshMcpOptions): string {
  if (opts?.dshHome) return opts.dshHome
  const env = process.env.DSH_HOME?.trim()
  return env || join(homeOf(opts), '.dsh')
}

export function getDshPatchPath(opts?: DshMcpOptions): string {
  return join(dshHomeOf(opts), 'profiles', opts?.dshProfile ?? DEFAULT_PROFILE, PATCH_FILENAME)
}

/** Parse the patch layer, or an empty document when it does not exist yet. */
function readPatchDocument(filePath: string): Document {
  const raw = existsSync(filePath) ? readFileSync(filePath, 'utf8') : ''
  // `logLevel: 'silent'`: dsh's own `!!js` tag is unknown to this parser, which
  // preserves it verbatim but warns on every read.
  const doc = parseDocument(raw, { logLevel: 'silent' })
  // A missing, empty, or non-list patch layer starts over as an empty list; the
  // header explains the file to whoever opens it next.
  if (isSeq(doc.contents)) return doc
  return parseDocument(NEW_FILE_HEADER + '[]\n', { logLevel: 'silent' })
}

function writePatchDocument(filePath: string, doc: Document): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, String(doc), 'utf8')
}

function entriesOf(doc: Document): YAMLSeq {
  return doc.contents as YAMLSeq
}

function isMcpEntry(item: unknown): item is YAMLMap {
  return isMap(item) && item.get('name') === MCP_CLIENT_PACKAGE
}

function serverNameOf(entry: YAMLMap): string | null {
  const config = entry.get('config')
  if (!isMap(config)) return null
  const name = config.get('serverName')
  return typeof name === 'string' && name ? name : null
}

function findEntry(doc: Document, name: string): YAMLMap | undefined {
  return entriesOf(doc).items.find(
    (item) => isMcpEntry(item) && serverNameOf(item) === name,
  ) as YAMLMap | undefined
}

export function listDshMcpConfigs(_cwd: string, opts?: DshMcpOptions): McpServerConfig[] {
  const filePath = getDshPatchPath(opts)
  if (!existsSync(filePath)) return []
  const doc = readPatchDocument(filePath)
  const configs: McpServerConfig[] = []
  for (const item of entriesOf(doc).items) {
    if (!isMcpEntry(item)) continue
    const name = serverNameOf(item)
    if (!name) continue
    const configNode = item.get('config', true)
    if (!isMap(configNode)) continue
    const raw = configNode.toJSON() as Record<string, unknown>
    const config = { name, scope: 'user' as ResourceScope } as McpServerConfig
    if (raw.transport === 'streamable-http') {
      if (typeof raw.url !== 'string' || !raw.url) continue
      config.type = 'http'
      config.url = raw.url
      if (raw.headers && typeof raw.headers === 'object') {
        config.headers = raw.headers as Record<string, string>
      }
    } else {
      if (typeof raw.command !== 'string' || !raw.command) continue
      config.type = 'stdio'
      config.command = raw.command
      if (Array.isArray(raw.args)) config.args = raw.args as string[]
      if (raw.env && typeof raw.env === 'object') config.env = raw.env as Record<string, string>
    }
    if (item.get('disabled') === true) config.disabled = true
    configs.push(config)
  }
  return configs
}

function assertServerName(name: string): void {
  // dsh's own namespace contract for `mcp__<serverName>__<tool>`.
  if (!name || name.length > 32 || !/^[A-Za-z0-9_-]+$/.test(name)) {
    throw Object.assign(
      new Error('invalid MCP server name: dsh allows [A-Za-z0-9_-], up to 32 characters'),
      { code: 'invalid_argument' },
    )
  }
}

function assertUserScope(scope: Extract<ResourceScope, 'user' | 'project'>): void {
  if (scope === 'project') {
    throw Object.assign(
      new Error('dsh composes per deployment: its MCP servers have no project scope'),
      { code: 'invalid_argument' },
    )
  }
}

export function saveDshMcpConfig(
  name: string,
  config: Partial<Pick<McpServerConfig, 'type' | 'command' | 'args' | 'env' | 'url' | 'headers'>>,
  scope: Extract<ResourceScope, 'user' | 'project'>,
  _cwd: string,
  opts?: DshMcpOptions,
): void {
  assertServerName(name)
  assertUserScope(scope)
  const filePath = getDshPatchPath(opts)
  const doc = readPatchDocument(filePath)

  let entryConfig: Record<string, unknown>
  if (config.type === 'http' || config.type === 'sse') {
    if (!config.url || typeof config.url !== 'string') {
      throw Object.assign(new Error('http/sse MCP requires url'), { code: 'invalid_argument' })
    }
    // dsh speaks stdio and Streamable HTTP; SSE has no transport there.
    entryConfig = {
      serverName: name,
      transport: 'streamable-http',
      url: config.url,
      ...(config.headers && Object.keys(config.headers).length > 0 ? { headers: config.headers } : {}),
    }
  } else {
    if (!config.command || typeof config.command !== 'string') {
      throw Object.assign(new Error('stdio MCP requires command'), { code: 'invalid_argument' })
    }
    entryConfig = {
      serverName: name,
      transport: 'stdio',
      command: config.command,
      args: config.args ?? [],
      ...(config.env && Object.keys(config.env).length > 0 ? { env: config.env } : {}),
    }
  }

  const existing = findEntry(doc, name)
  if (existing) {
    // Replace only the config: an `id`, a `disabled` flag, or anything else the
    // user put on this entry is theirs.
    existing.set('config', doc.createNode(entryConfig))
  } else {
    entriesOf(doc).add(doc.createNode({
      id: `mcp-${name}`,
      name: MCP_CLIENT_PACKAGE,
      config: entryConfig,
    }))
  }
  writePatchDocument(filePath, doc)
}

export function toggleDshMcpConfig(
  name: string,
  disabled: boolean,
  scope: Extract<ResourceScope, 'user' | 'project'>,
  _cwd: string,
  opts?: DshMcpOptions,
): void {
  assertServerName(name)
  assertUserScope(scope)
  const filePath = getDshPatchPath(opts)
  const doc = readPatchDocument(filePath)
  const entry = findEntry(doc, name)
  if (!entry) {
    throw Object.assign(new Error(`MCP server not found: ${name}`), { code: 'not_found' })
  }
  if (disabled) entry.set('disabled', true)
  else entry.delete('disabled')
  writePatchDocument(filePath, doc)
}

export function deleteDshMcpConfig(
  name: string,
  scope: Extract<ResourceScope, 'user' | 'project'>,
  _cwd: string,
  opts?: DshMcpOptions,
): void {
  assertServerName(name)
  assertUserScope(scope)
  const filePath = getDshPatchPath(opts)
  const doc = readPatchDocument(filePath)
  const seq = entriesOf(doc)
  const index = seq.items.findIndex((item) => isMcpEntry(item) && serverNameOf(item) === name)
  if (index < 0) {
    throw Object.assign(new Error(`MCP server not found: ${name}`), { code: 'not_found' })
  }
  seq.delete(index)
  writePatchDocument(filePath, doc)
}
