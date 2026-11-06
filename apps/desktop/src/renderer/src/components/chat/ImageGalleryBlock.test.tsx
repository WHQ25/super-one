/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImageGenerationItem } from '@superone/shared/agent-types'
import { toLocalFileUrl } from '@/lib/path-utils'
import { ImageGalleryBlock } from './ImageGalleryBlock'

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
    const { container } = render(<ImageGalleryBlock items={items} projectPath={root} />)
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
    const { container } = render(<ImageGalleryBlock items={items} projectPath={root} />)
    expect(container.querySelector('img')).toBeNull()
  })

  it('shows the error tile when the file is missing', async () => {
    window.app.readProjectFile = vi.fn(async () => ({ path, content: '', language: 'text', error: 'missing' }))
    const { container } = render(<ImageGalleryBlock items={items} projectPath={root} />)
    await waitFor(() => expect(container.querySelector('.text-destructive')).not.toBeNull())
    expect(container.querySelector('img')).toBeNull()
  })

  it('keeps local galleries synchronous without a remote file read', () => {
    const { container } = render(<ImageGalleryBlock items={items.map(item => ({ ...item, savedPath: mirror }))} projectPath="/local/project" />)
    expect(container.querySelector('img')?.getAttribute('src')).toContain('/Users/viewer/')
    expect(window.app.readProjectFile).not.toHaveBeenCalled()
  })

  it('reuses the mirror while unrelated streamed text changes the items array', async () => {
    const { container, rerender } = render(<ImageGalleryBlock items={items} projectPath={root} />)
    await waitFor(() => expect(container.querySelector('img')).not.toBeNull())
    rerender(<ImageGalleryBlock items={items.map(item => ({ ...item, revisedPrompt: 'Updated caption' }))} projectPath={root} />)
    expect(window.app.readProjectFile).toHaveBeenCalledTimes(1)
    expect(container.querySelector('img')).toHaveAttribute('alt', 'Updated caption')
  })

  it('falls back to the original when its optional thumbnail is missing', async () => {
    window.app.readProjectFile = vi.fn(async (_root, source) => source === path
      ? { path: source, content: toLocalFileUrl(mirror), language: 'image' }
      : { path: source, content: '', language: 'text', error: 'missing' })
    const { container } = render(<ImageGalleryBlock items={items.map(item => ({ ...item, previewPath: '/node/preview.png' }))} projectPath={root} />)
    await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).toContain('/Users/viewer/'))
  })
})
