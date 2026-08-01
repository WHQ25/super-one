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
    // Outside project root — fall back to host path (works for same-machine lab).
    return toLocalFileUrl(src)
  }
  return encodeRemoteMediaUrl(projectPath, clean)
}

/**
 * Turn a remote-media ref (or already-resolved src) into a browser-displayable URL.
 * Uses readProjectFile which returns data: URIs for media on remote projects.
 */
export async function resolveDisplayMediaSrc(src: string): Promise<string | null> {
  if (!src) return null
  if (src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://') || src.startsWith('blob:')) {
    return src
  }
  const remote = decodeRemoteMediaUrl(src)
  if (!remote) return src

  try {
    const file = await window.app.readProjectFile(remote.projectPath, remote.relativePath)
    if (file.language === 'too-large' || file.language === 'binary') return null
    if (file.content.startsWith('data:')) return file.content
    if (file.language === 'svg' && file.content) {
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(file.content)}`
    }
    // Unexpected text file referenced as media — still try as svg/text data
    if (file.content) {
      return `data:application/octet-stream;base64,${btoa(file.content)}`
    }
    return null
  } catch {
    return null
  }
}
