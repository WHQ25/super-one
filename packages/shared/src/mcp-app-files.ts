import { MCP_APP_OUTPUT_MAX_BYTES, type McpToolDescriptor } from './mcp-apps'

/** Opaque URI for a file an App opened through its file entrypoint; never a filesystem path. */
export const MCP_APP_HOST_RESOURCE_PREFIX = 'host-resource://'
/** Raw file bytes whose base64 read still fits the transient View output cap. */
export const MCP_APP_RESOURCE_READ_MAX_BYTES = Math.floor(MCP_APP_OUTPUT_MAX_BYTES / 4) * 3 - 64 * 1024
/** UTF-8 text or decoded blob bytes: a file an App can open, it can also save. */
export const MCP_APP_RESOURCE_WRITE_MAX_BYTES = MCP_APP_RESOURCE_READ_MAX_BYTES

export interface McpAppFileInput { file: { name: string; resourceUri: string } }

/** A tool that can open a file, as offered in "Open With". */
export interface McpAppFileHandler {
  server: string
  tool: string
  /** Tool title, then `annotations.title`, then the tool name. */
  title: string
  serverTitle?: string
  icon?: string
}

/**
 * `unavailable` says why no App can be offered when the host cannot ask the harness at all.
 * `incomplete` means some server did not answer (still starting, down, signed out); ask again later.
 */
export interface McpAppFileHandlersResult { handlers: McpAppFileHandler[]; unavailable?: 'remote' | 'no-session'; incomplete?: true }

export type McpAppResourceWriteParams = { uri: string; ifMatch?: string } & ({ text: string; blob?: never } | { blob: string; text?: never })
export type McpAppResourceWriteResult =
  | { outcome: 'saved'; etag: string }
  | { outcome: 'conflict'; etag: string }
  | { outcome: 'too-large'; maxBytes: number }

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined

/** Lowercased extension with its dot (`.stl`), or `''`. */
export function mcpAppFileExtension(name: string): string {
  const base = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot).toLowerCase() : ''
}

/** Extensions a tool's `openai/ui` file entrypoint declares, lowercased; only the `.ext` form is valid. */
export function mcpAppFileExtensions(tool: McpToolDescriptor): string[] {
  const entrypoints = record(tool._meta?.['openai/ui'])?.entrypoints
  if (!Array.isArray(entrypoints)) return []
  const extensions = new Set<string>()
  for (const entry of entrypoints) {
    const value = record(entry)
    if (value?.type !== 'file' || !Array.isArray(value.extensions)) continue
    for (const extension of value.extensions) {
      if (typeof extension === 'string' && /^\.[^./\\\s]+$/.test(extension)) extensions.add(extension.toLowerCase())
    }
  }
  return [...extensions]
}

export function isMcpAppHostResource(uri: string): boolean {
  return uri.startsWith(MCP_APP_HOST_RESOURCE_PREFIX)
}
