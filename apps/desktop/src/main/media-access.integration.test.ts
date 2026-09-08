import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const state = vi.hoisted(() => ({ userData: '', downloads: '' }))
vi.mock('electron', () => ({ app: { getPath: (key: string) => key === 'downloads' ? state.downloads : state.userData } }))
vi.mock('./recent-folders', () => ({ getRecentFolders: () => [] }))
vi.mock('./session/session-repo', () => ({ listWorktreePaths: () => [] }))
// Isolate the host-owned roots from ambient user projects and the legacy /tmp allowance.
vi.mock('./path-security', async (original) => ({
  ...await original<typeof import('./path-security')>(),
  getReadableAssetRoots: (roots: string[]) => roots,
}))
vi.mock('./logger', () => ({ default: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('./agent/event-trace', () => ({ trace: vi.fn() }))
vi.mock('./app-settings-service', () => ({ readAppSettings: () => ({}) }))
vi.mock('./browser/browser-automation-bridge', () => ({ browserAutomationCall: vi.fn() }))
vi.mock('./miniapp/miniapp-service', () => ({
  getAppBasePath: () => '', generateCSP: () => '', readManifest: vi.fn(), validatePath: vi.fn(),
}))

import { builtInCaptureRoots } from './media-output-paths'
import { mediaGenOutputRoot } from './media-gen/paths'
import { registerMiniAppProtocolHandlers } from './miniapp/miniapp-protocol'
import { downloadUrl } from './browser/browser-downloads'
import { startMediaServer, stopMediaServer, getMediaServerPort } from './media-server'

type Handler = (request: Request) => Promise<Response>
let localFile: Handler
let root: string
const captures: string[] = []
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'superone-media-access-'))
  state.userData = join(root, 'userData')
  state.downloads = join(root, 'downloads')
  mkdirSync(state.userData)
  registerMiniAppProtocolHandlers({ handle: (scheme: string, handler: Handler) => {
    if (scheme === 'local-file') localFile = handler
  } } as never)
})
afterEach(() => {
  stopMediaServer()
  for (const path of captures.splice(0)) rmSync(path, { force: true })
  rmSync(root, { recursive: true, force: true })
})
function write(path: string): string {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, 'test-media-bytes')
  return path
}

describe('built-in media delivery', () => {
  it('serves every capture root and generated outputs through local-file, excluding media credentials', async () => {
    for (const dir of [...builtInCaptureRoots(state.userData), mediaGenOutputRoot()]) {
      const path = write(join(dir, `access-test-${root.split('/').pop()}.png`))
      captures.push(path)
      const response = await localFile(new Request(`local-file://${path}`))
      expect(response.status, path).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('image/png')
      expect(await response.text()).toBe('test-media-bytes')
    }
    const credentials = write(join(state.userData, 'media-gen', 'keys.bin'))
    expect((await localFile(new Request(`local-file://${credentials}`))).status).toBe(403)
  })

  it('renders a completed download outside projects without opening sibling files', async () => {
    const result = await downloadUrl('data:image/png;base64,aW1hZ2U=', { dir: state.downloads, filename: 'download.png' })
    expect((await localFile(new Request(`local-file://${result.path}`))).status).toBe(200)
    const sibling = write(join(state.downloads, 'private.png'))
    expect((await localFile(new Request(`local-file://${sibling}`))).status).toBe(403)
  })

  it('streams audio and video ranges with matching MIME types on both transports', async () => {
    await startMediaServer()
    for (const [ext, mime] of [['mp4', 'video/mp4'], ['opus', 'audio/ogg'], ['weba', 'audio/webm']]) {
      const path = write(join(mediaGenOutputRoot(), `clip.${ext}`))
      const requests = [
        localFile(new Request(`local-file://${path}`, { headers: { Range: 'bytes=2-5' } })),
        fetch(`http://127.0.0.1:${getMediaServerPort()}${path}`, { headers: { Range: 'bytes=2-5' } }),
      ]
      for (const response of await Promise.all(requests)) {
        expect(response.status).toBe(206)
        expect(response.headers.get('Content-Type')).toBe(mime)
        expect(await response.text()).toBe('st-m')
      }
    }
  })
})
