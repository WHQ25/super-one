/**
 * Opaque URL scheme for chat markdown media under a remote project key
 * (`remote:<connectionId>:<hostPath>`). Renderers resolve these via
 * `window.app.readProjectFile` → data URI.
 */

import { parseRemoteProjectKey } from '@/lib/remote-project-key'
import { toLocalFileUrl } from '@/lib/path-utils'

const PREFIX = 'remote-media://ref/'

function encodeBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decodeBase64Url(b64url: string): string {
  const pad = b64url.length % 4 === 0 ? '' : '='.repeat(4 - (b64url.length % 4))
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + pad
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

export function isRemoteMediaUrl(src: string | undefined | null): boolean {
  return Boolean(src?.startsWith(PREFIX))
}

export function encodeRemoteMediaUrl(projectPath: string, relativePath: string): string {
  const payload = JSON.stringify({
    p: projectPath,
    f: relativePath.replace(/\\/g, '/').replace(/^\.\//, ''),
  })
  return `${PREFIX}${encodeBase64Url(payload)}`
}

export function decodeRemoteMediaUrl(
  src: string,
): { projectPath: string; relativePath: string } | null {
  if (!src.startsWith(PREFIX)) return null
  try {
    const json = decodeBase64Url(src.slice(PREFIX.length))
    const parsed = JSON.parse(json) as { p?: string; f?: string }
    if (!parsed.p || typeof parsed.f !== 'string') return null
    return { projectPath: parsed.p, relativePath: parsed.f }
  } catch {
    return null
  }
}

/** Host-absolute path under the remote project root → project-relative, or null. */
export function relativeUnderRemoteProject(
  projectPath: string,
  absoluteHostPath: string,
): string | null {
  const remote = parseRemoteProjectKey(projectPath)
  if (!remote) return null
  const root = remote.path.replace(/\\/g, '/').replace(/\/+$/, '') || '/'
  const full = absoluteHostPath.replace(/\\/g, '/').replace(/\/+$/, '') || '/'
  if (full === root) return '.'
  if (full.startsWith(`${root}/`)) return full.slice(root.length + 1)
  return null
}

/**
 * Build a displayable media src for markdown: remote-media ref or local-file URL.
 */
export function resolveMediaSrcForProject(src: string, projectPath: string): string {
  const remote = parseRemoteProjectKey(projectPath)
  const clean = src.replace(/^\.\//, '')

  if (!remote) {
    if (src.startsWith('/') || /^[A-Za-z]:[\\/]/.test(src)) {
      return toLocalFileUrl(src)
    }
    return toLocalFileUrl(`${projectPath.replace(/\/$/, '')}/${clean}`)
  }

  if (src.startsWith('/') || /^[A-Za-z]:[\\/]/.test(src)) {
    const rel = relativeUnderRemoteProject(projectPath, src)
    if (rel != null && rel !== '.') return encodeRemoteMediaUrl(projectPath, rel)
    // Outside the project root — a session sync-zone artifact (a screenshot, a
    // generated image) or an out-of-project file. Keep the connection and carry
    // the absolute node path so the main process resolves it through
    // resolveSessionFile (session-sync-zone.md §4.2) instead of losing it to a
    // local-file URL that only worked on a same-machine lab.
    return encodeRemoteMediaUrl(projectPath, src)
  }
  return encodeRemoteMediaUrl(projectPath, clean)
}

export type DisplayMediaResult = { url: string } | { failure: 'too-large' | 'unavailable' }

/**
 * Turn a remote-media ref (or already-resolved src) into a browser-displayable URL.
 * Uses readProjectFile, which returns a data: URI for media on the node and a
 * local-file: URL for media mirrored into the session zone.
 * `too-large` stays distinct from a missing file so a preview can say why.
 */
export async function resolveDisplayMedia(src: string): Promise<DisplayMediaResult> {
  if (!src) return { failure: 'unavailable' }
  if (src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://') || src.startsWith('blob:')) {
    return { url: src }
  }
  const remote = decodeRemoteMediaUrl(src)
  if (!remote) return { url: src }

  try {
    const file = await window.app.readProjectFile(remote.projectPath, remote.relativePath)
    if (file.language === 'too-large') return { failure: 'too-large' }
    if (file.language === 'binary') return { failure: 'unavailable' }
    // Node media arrives as a data URI; session-zone media as the URL of its
    // desktop mirror, which the local-file protocol streams at any size.
    if (file.content.startsWith('data:') || file.content.startsWith('local-file:')) return { url: file.content }
    if (file.language === 'svg' && file.content) {
      return { url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(file.content)}` }
    }
    // Unexpected text file referenced as media — still try as svg/text data
    if (file.content) {
      return { url: `data:application/octet-stream;base64,${btoa(file.content)}` }
    }
    return { failure: 'unavailable' }
  } catch {
    return { failure: 'unavailable' }
  }
}

/** URL form of `resolveDisplayMedia`. A refusal, of either kind, is null. */
export async function resolveDisplayMediaSrc(src: string): Promise<string | null> {
  const result = await resolveDisplayMedia(src)
  return 'url' in result ? result.url : null
}
