/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImageGenerationItem } from '@superone/shared/agent-types'
import { toLocalFileUrl } from '@/lib/path-utils'
import { GeneratedMediaGalleryBlock } from './GeneratedMediaGalleryBlock'

const root = 'remote:node:/home/node/project'
const path = '/home/node/sync/s1/media-gen/screenshot.png'
const mirror = '/Users/viewer/Library/Application Support/SuperOne/sync/s1/media-gen/screenshot.png'
const items: ImageGenerationItem[] = [{ id: 'image', type: 'image_generation', status: 'completed', savedPath: path, revisedPrompt: 'Screenshot' }]

beforeEach(() => {
  window.app.readProjectFile = vi.fn(async (_root, source) => ({ path: source, content: toLocalFileUrl(mirror), language: 'image' }))
  window.app.saveFileAs = vi.fn(async () => ({ ok: false as const, canceled: true }))
})

describe('node gallery image paths', () => {
  it('uses the desktop mirror for the thumbnail, viewer and download', async () => {
    const { container } = render(<GeneratedMediaGalleryBlock items={items} projectPath={root} />)
    await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).toContain('/Users/viewer/'))
    expect(window.app.readProjectFile).toHaveBeenCalledWith(root, path)
    fireEvent.click(screen.getByRole('button', { name: 'Screenshot' }))
    const dialog = screen.getByRole('dialog')
    await waitFor(() => expect(dialog.querySelector('img')?.getAttribute('src')).toContain('/Users/viewer/'))
    fireEvent.click(screen.getByRole('button', { name: 'Download image' }))
    await waitFor(() => expect(window.app.saveFileAs).toHaveBeenCalledWith(mirror, expect.any(String), undefined))
  })

  it('does not load a foreign path while its mirror is still being fetched', () => {
    window.app.readProjectFile = vi.fn(() => new Promise<Awaited<ReturnType<typeof window.app.readProjectFile>>>(() => {}))
    const { container } = render(<GeneratedMediaGalleryBlock items={items} projectPath={root} />)
    expect(container.querySelector('img')).toBeNull()
  })

  it('shows the error tile when the file is missing', async () => {
    window.app.readProjectFile = vi.fn(async () => ({ path, content: '', language: 'text', error: 'missing' }))
    const { container } = render(<GeneratedMediaGalleryBlock items={items} projectPath={root} />)
    await waitFor(() => expect(container.querySelector('.text-destructive')).not.toBeNull())
    expect(container.querySelector('img')).toBeNull()
  })

  it('keeps local galleries synchronous without a remote file read', () => {
    const { container } = render(<GeneratedMediaGalleryBlock items={items.map(item => ({ ...item, savedPath: mirror }))} projectPath="/local/project" />)
    expect(container.querySelector('img')?.getAttribute('src')).toContain('/Users/viewer/')
    expect(window.app.readProjectFile).not.toHaveBeenCalled()
  })

  it('reuses the mirror while unrelated streamed text changes the items array', async () => {
    const { container, rerender } = render(<GeneratedMediaGalleryBlock items={items} projectPath={root} />)
    await waitFor(() => expect(container.querySelector('img')).not.toBeNull())
    rerender(<GeneratedMediaGalleryBlock items={items.map(item => ({ ...item, revisedPrompt: 'Updated caption' }))} projectPath={root} />)
    expect(window.app.readProjectFile).toHaveBeenCalledTimes(1)
    expect(container.querySelector('img')).toHaveAttribute('alt', 'Updated caption')
  })

  it('falls back to the original when its optional thumbnail is missing', async () => {
    window.app.readProjectFile = vi.fn(async (_root, source) => source === path
      ? { path: source, content: toLocalFileUrl(mirror), language: 'image' }
      : { path: source, content: '', language: 'text', error: 'missing' })
    const { container } = render(<GeneratedMediaGalleryBlock items={items.map(item => ({ ...item, previewPath: '/node/preview.png' }))} projectPath={root} />)
    await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).toContain('/Users/viewer/'))
  })
})

it('keeps the active player mounted while the mixed media sidebar collapses', () => {
  const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640)
  const { container } = render(<GeneratedMediaGalleryBlock items={[
    ...items,
    { id: 'clip', type: 'video_generation', status: 'completed', savedPath: '/tmp/preview.mp4', prompt: 'Animation' },
  ]} />)
  width.mockRestore()
  const videos = screen.getByRole('list', { name: 'Video' })
  const images = screen.getByRole('list', { name: 'Image' })
  expect(within(videos).getAllByRole('listitem')).toHaveLength(1)
  expect(within(images).getAllByRole('listitem')).toHaveLength(1)
  fireEvent.click(within(videos).getByRole('button', { name: 'preview.mp4' }))
  const preview = container.querySelector('[data-generated-media-preview]')!
  const video = preview.querySelector('video')
  expect(video).toHaveAttribute('aria-label', 'Animation')
  fireEvent.click(screen.getByRole('button', { name: 'Collapse Media Sidebar' }))
  expect(screen.queryByRole('list')).toBeNull()
  expect(preview.querySelector('video')).toBe(video)
  const handle = screen.getByRole('button', { name: 'Expand Media Sidebar' })
  handle.setPointerCapture = vi.fn()
  fireEvent.pointerDown(handle, { pointerId: 1, isPrimary: true, button: 0, clientX: 600 })
  fireEvent.pointerUp(handle, { pointerId: 1, isPrimary: true, button: 0, clientX: 550 })
  fireEvent.click(handle, { detail: 1 })
  expect(handle).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('button', { name: 'preview.mp4' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByRole('button', { name: 'screenshot.png' }))
  expect(preview.isConnected).toBe(false)
  expect(screen.getByRole('button', { name: 'Screenshot' })).toBeVisible()
})
