import { readFile } from 'fs/promises'
import { join } from 'path'
import { MINIAPP_DEV_SERVER_FILE } from '@superone/shared/miniapp-types'
import * as devRegistry from './dev-registry'
import { getAppBasePath } from './miniapp-service'

/**
 * A development mini-app's front-end dev server (Vite), which SuperOne serves
 * through `superone-app://` so edits hot-reload without a build.
 *
 * The dev server reports itself: the template's Vite plugin writes
 * MINIAPP_DEV_SERVER_FILE in the app's source directory while it listens. The page
 * keeps its `superone-app://` origin, so the WebView guards, the manifest CSP and
 * per-project storage behave exactly as for built files.
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** The dev server's origin for an active development app, or null to serve its build. */
export async function devServerOrigin(appId: string): Promise<string | null> {
  const reg = await devRegistry.lookupByAppId(appId)
  // An installed copy of the same app id keeps serving its own files.
  if (!reg || getAppBasePath(appId) !== reg.distDir) return null
  let raw: string
  try {
    raw = await readFile(join(reg.sourceDir, MINIAPP_DEV_SERVER_FILE), 'utf-8')
  } catch {
    return null
  }
  try {
    const url = new URL((JSON.parse(raw) as { url?: unknown }).url as string)
    // Only a server on this machine: the file sits in a project an agent can write.
    if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname)) return null
    return url.origin
  } catch {
    return null
  }
}

const REACHABLE_TIMEOUT_MS = 1_000

/**
 * The dev server a development app is served from right now: reported and
 * answering. A server killed without cleanup leaves its file behind.
 */
export async function reachableDevServer(appId: string): Promise<string | null> {
  const origin = await devServerOrigin(appId)
  if (!origin) return null
  try {
    await fetch(origin, { method: 'HEAD', signal: AbortSignal.timeout(REACHABLE_TIMEOUT_MS) })
    return origin
  } catch {
    return null
  }
}

/** The WebSocket origin the Vite HMR client connects to. */
export function devServerSocketOrigin(origin: string): string {
  return origin.replace(/^http:/, 'ws:')
}

/**
 * Forward one `superone-app://` request to the dev server. Null when it does not
 * answer (stopped, or crashed and left its file behind): the caller serves the build.
 */
export async function fetchFromDevServer(origin: string, url: URL): Promise<Response | null> {
  const path = url.pathname === '/' ? '/index.html' : url.pathname
  try {
    return await fetch(`${origin}${path}${url.search}`, { redirect: 'manual' })
  } catch {
    return null
  }
}
