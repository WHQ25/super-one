import { createWriteStream } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { McpAppsError, type McpAppDownloadContents, type McpAppReadResult } from '@superone/shared/mcp-apps'
import { isMcpAppHttpDownload, mcpAppDownloadName } from '@superone/shared/mcp-app-download'

export interface McpAppDownloadPorts {
  /** Save dialog for one item; the chosen path, or null when the user cancels. */
  choosePath(name: string, signal: AbortSignal): Promise<string | null>
  /** A non-http resource link, read from the View's own server. */
  read(uri: string, signal: AbortSignal): Promise<McpAppReadResult>
  fetch?: typeof fetch
}

function contentBytes(content: { text?: unknown; blob?: unknown }): Buffer {
  if (typeof content.text === 'string') return Buffer.from(content.text, 'utf8')
  if (typeof content.blob === 'string') return Buffer.from(content.blob, 'base64')
  throw new McpAppsError('invalid', 'The download has no content')
}

async function saveLink(uri: string, path: string, ports: McpAppDownloadPorts, signal: AbortSignal): Promise<void> {
  // No cookies or credentials: SuperOne's browser sessions never reach a View-chosen URL.
  const response = await (ports.fetch ?? fetch)(uri, { signal, credentials: 'omit', redirect: 'follow' })
  if (!response.ok || !response.body) throw new McpAppsError('not_connected', `Download failed (${response.status})`)
  // Streamed straight to the file the user chose, so its size never sits in memory.
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(path), { signal })
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
    if (isMcpAppHttpDownload(item.uri)) { await saveLink(item.uri, path, ports, signal); continue }
    const read = await ports.read(item.uri, signal)
    const content = read.contents.find(value => value.uri === item.uri) ?? read.contents[0]
    if (!content) throw new McpAppsError('invalid', 'The linked resource is empty')
    await writeFile(path, contentBytes(content), { signal })
  }
  return {}
}
