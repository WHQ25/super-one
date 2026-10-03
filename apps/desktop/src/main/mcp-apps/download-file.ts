import { createWriteStream } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { McpAppsError, type McpAppDownloadContents, type McpAppReadResult } from '@superone/shared/mcp-apps'

/** A linked download streams to disk; the View never sees it, so this only bounds the disk write. */
export const MCP_APP_LINK_DOWNLOAD_MAX_BYTES = 256 * 1024 * 1024

export interface McpAppDownloadPorts {
  /** Save dialog for one item; the chosen path, or null when the user cancels. */
  choosePath(name: string, signal: AbortSignal): Promise<string | null>
  /** A non-http resource link, read from the View's own server. */
  read(uri: string, signal: AbortSignal): Promise<McpAppReadResult>
  fetch?: typeof fetch
}

type Item = McpAppDownloadContents[number]

/** A plain file name from the item: never a path, never empty. */
export function mcpAppDownloadName(item: Item): string {
  const uri = item.type === 'resource' ? item.resource.uri : item.uri
  let path: string
  try { path = new URL(uri).pathname } catch { path = uri.split(/[?#]/)[0] }
  let segment = path.split('/').filter(Boolean).pop() ?? ''
  try { segment = decodeURIComponent(segment) } catch { /* Keep the encoded segment. */ }
  // A link's display name wins when it is itself a file name (`q4.pdf`, not "Q4 Report").
  const linkName = item.type === 'resource_link' ? item.name : ''
  const name = /\.[^.\s]+$/.test(linkName) ? linkName : segment || linkName
  const clean = [...name].filter(char => char.charCodeAt(0) >= 32).join('').replace(/[/\\:*?"<>|]/g, '_').replace(/^\.+/, '').trim().slice(0, 200)
  return clean || 'download'
}

function contentBytes(content: { text?: unknown; blob?: unknown }): Buffer {
  if (typeof content.text === 'string') return Buffer.from(content.text, 'utf8')
  if (typeof content.blob === 'string') return Buffer.from(content.blob, 'base64')
  throw new McpAppsError('invalid', 'The download has no content')
}

function isHttp(uri: string): boolean {
  try {
    const url = new URL(uri)
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
  } catch { return false }
}

async function saveLink(uri: string, path: string, ports: McpAppDownloadPorts, signal: AbortSignal): Promise<void> {
  // No cookies or credentials: SuperOne's browser sessions never reach a View-chosen URL.
  const response = await (ports.fetch ?? fetch)(uri, { signal, credentials: 'omit', redirect: 'follow' })
  if (!response.ok || !response.body) throw new McpAppsError('not_connected', `Download failed (${response.status})`)
  if (Number(response.headers.get('content-length')) > MCP_APP_LINK_DOWNLOAD_MAX_BYTES) throw new McpAppsError('invalid', 'The download is too large')
  let bytes = 0
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      bytes += chunk.byteLength
      done(bytes > MCP_APP_LINK_DOWNLOAD_MAX_BYTES ? new McpAppsError('invalid', 'The download is too large') : null, chunk)
    },
  })
  await pipeline(Readable.fromWeb(response.body as never), limit, createWriteStream(path), { signal })
}

/**
 * Saves each item where the user picks; the first cancel stops the rest and reports
 * `isError`, as the spec asks. Bytes are fetched only after a path is chosen.
 */
export async function saveMcpAppDownloads(contents: McpAppDownloadContents, ports: McpAppDownloadPorts, signal: AbortSignal): Promise<{ isError?: boolean }> {
  for (const item of contents) {
    const path = await ports.choosePath(mcpAppDownloadName(item), signal)
    if (!path) return { isError: true }
    if (signal.aborted) throw new McpAppsError('cancelled', 'MCP App download cancelled')
    if (item.type === 'resource') { await writeFile(path, contentBytes(item.resource), { signal }); continue }
    if (isHttp(item.uri)) { await saveLink(item.uri, path, ports, signal); continue }
    const read = await ports.read(item.uri, signal)
    const content = read.contents.find(value => value.uri === item.uri) ?? read.contents[0]
    if (!content) throw new McpAppsError('invalid', 'The linked resource is empty')
    await writeFile(path, contentBytes(content), { signal })
  }
  return {}
}
