/** @vitest-environment jsdom */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { EnvironmentHost } from '../../main/environment/environment-host'
import { PNG_ATTACHMENT } from '@superone/shared/test-fixtures/attachments'
import { localFileUrlToPath } from '@superone/shared/path-display'

const state = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.userData } }))
vi.mock('../../main/database', async () => (await import('../fixtures/delivery-db')).deliveryDatabase())
vi.mock('../../main/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../../main/recent-folders', () => ({ getRecentFolders: () => [] }))
vi.mock('../../main/session/session-repo', () => ({ listWorktreePaths: () => [] }))
// Remove ambient /tmp readability: the host must grant the completed cache file.
vi.mock('../../main/path-security', async original => ({
  ...await original<typeof import('../../main/path-security')>(),
  getReadableAssetRoots: (roots: string[]) => roots,
}))

import { readRemoteProjectFile } from '../../main/environment/remote-file-tree'
import { startMediaServer, stopMediaServer, mediaServerUrl } from '../../main/media-server'
import { ImageGalleryBlock } from '../../renderer/src/components/chat/ImageGalleryBlock'

const root = 'remote:gallery-node:/work/project'
const image = '/work/project/output/image.png'
const png = Buffer.from(PNG_ATTACHMENT.base64, 'base64')
let cached: string | null = null

beforeEach(() => {
  state.userData = mkdtempSync(join(tmpdir(), 'project-gallery-'))
  cached = null
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})
afterEach(() => {
  stopMediaServer()
  if (cached) rmSync(cached, { force: true })
  rmSync(state.userData, { recursive: true, force: true })
})

it('streams a node project image through the gallery, full viewer and native download', async () => {
  const readFile = vi.fn(async () => ({ content: png }))
  const host = {
    connections: { listKnown: () => [{ connectionId: 'gallery-node', environmentId: 'node' }] },
    listProjects: async () => [{ projectId: 'project', path: '/work/project' }],
    workspace: () => ({
      readFile,
      listDir: async () => [{ name: 'image.png', type: 'file', size: png.length, mtimeMs: 1_700_000_000_000 }],
    }),
  } as unknown as EnvironmentHost
  window.app.readProjectFile = vi.fn(async (projectPath, path) => {
    const file = await readRemoteProjectFile(host, projectPath, path)
    if (!file) throw new Error('missing project')
    cached = localFileUrlToPath(file.content)
    return file
  })
  window.app.saveFileAs = vi.fn(async () => ({ ok: false as const, canceled: true }))
  const { container } = render(<ImageGalleryBlock projectPath={root} items={[
    { id: 'project-image', type: 'image_generation', status: 'completed', savedPath: image, revisedPrompt: 'Project image' },
  ]} />)
  await waitFor(() => expect(container.querySelector('img')).not.toBeNull())
  expect(cached).toBeTruthy()
  expect(container.querySelector('img')?.getAttribute('src')).toContain('super-one-remote-project-cache-')
  expect(readFileSync(cached!)).toEqual(png)
  const response = await fetch(mediaServerUrl(cached!, await startMediaServer()))
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toBe('image/png')
  expect(Buffer.from(await response.arrayBuffer())).toEqual(png)
  fireEvent.click(screen.getByRole('button', { name: 'Project image' }))
  await waitFor(() => expect(screen.getByRole('dialog').querySelector('img')?.getAttribute('src')).toContain('super-one-remote-project-cache-'))
  fireEvent.click(screen.getByRole('button', { name: 'Download image' }))
  await waitFor(() => expect(window.app.saveFileAs).toHaveBeenCalledWith(cached, expect.any(String), undefined))
  expect(readFile).toHaveBeenCalledTimes(1)
})
