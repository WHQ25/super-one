import type { McpAppDownloadContents } from './mcp-apps'

type Item = McpAppDownloadContents[number]

/**
 * One `ui/download-file` item as a device saves it locally: the bytes the View sent,
 * or an http(s) URL the device fetches itself.
 */
export type McpAppLocalDownload = { name: string; mimeType: string } & ({ text: string } | { base64: string } | { url: string })

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

export const MCP_APP_BLOCKED_DOWNLOAD_EXTENSIONS: ReadonlySet<string> = new Set([
  '.action', '.apk', '.app', '.appimage', '.appx', '.bat', '.cmd', '.com', '.command', '.cpl',
  '.deb', '.desktop', '.dmg', '.exe', '.hta', '.jar', '.js', '.jse', '.lnk', '.msi', '.msix',
  '.pif', '.pkg', '.ps1', '.reg', '.rpm', '.scr', '.url', '.vbe', '.vbs', '.workflow', '.wsf', '.wsh',
])

function rawItemLeaf(item: Item): string {
  const uri = item.type === 'resource' ? item.resource.uri : item.uri
  let pathname: string
  try { pathname = new URL(uri).pathname } catch { pathname = uri.split(/[?#]/)[0] }
  let segment = pathname.split('/').filter(Boolean).pop() ?? ''
  try { segment = decodeURIComponent(segment) } catch {}
  const linkName = item.type === 'resource_link' ? item.name : ''
  return /\.[^.\s]+$/.test(linkName) ? linkName : segment || linkName
}

export function isBlockedMcpAppDownloadName(nameOrPath: string): boolean {
  if (!nameOrPath) return true
  const withoutDrive = nameOrPath.replace(/^[A-Za-z]:(?=[\\/])/, '')
  const leaf = withoutDrive.split(/[/\\]/).filter(Boolean).pop() ?? ''
  if (!leaf || leaf.includes(':')) return true
  const trimmed = leaf.replace(/[. ]+$/, '').toLowerCase()
  if (!trimmed) return true
  const dot = trimmed.lastIndexOf('.')
  if (dot <= 0) return false
  return MCP_APP_BLOCKED_DOWNLOAD_EXTENSIONS.has(trimmed.slice(dot))
}

export function isBlockedMcpAppDownloadItem(item: Item): boolean {
  const raw = rawItemLeaf(item)
  if (raw.includes(':')) return true
  return isBlockedMcpAppDownloadName(raw) || isBlockedMcpAppDownloadName(mcpAppDownloadName(item))
}

/** A link a device may fetch on its own: http(s) without credentials. Anything else is read from the View's server. */
export function isMcpAppHttpDownload(uri: string): boolean {
  try {
    const url = new URL(uri)
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
  } catch { return false }
}
