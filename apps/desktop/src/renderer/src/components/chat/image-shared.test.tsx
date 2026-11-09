/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/stores/app'
import { ImageInteractive } from './image-shared'

beforeEach(() => {
  useAppStore.setState({ currentFolder: '/proj', liquidGlass: false })
})

function openMenu(label: string) {
  render(
    <ImageInteractive savedPath="/tmp/cat.png" downloadable onOpen={() => {}} className="" ariaLabel="cat">
      <img alt="cat" />
    </ImageInteractive>,
  )
  fireEvent.contextMenu(screen.getByRole('button', { name: 'cat' }))
  return screen.getByRole('menuitem', { name: label })
}

describe('image context menu', () => {
  it('saves a copy and still offers download for a generated image', async () => {
    const saveFileAs = vi.fn<Window['app']['saveFileAs']>()
      .mockResolvedValueOnce({ ok: true, savedPath: '/out/cat.png' })
      .mockResolvedValueOnce({ ok: false, canceled: true })
    Object.assign(window.app, { saveFileAs, clipboardWriteImage: vi.fn(), revealFile: vi.fn() })

    fireEvent.click(openMenu('Save As'))
    await waitFor(() => expect(saveFileAs).toHaveBeenCalledWith('/tmp/cat.png', 'cat.png', '/proj'))

    fireEvent.contextMenu(screen.getByRole('button', { name: 'cat' }))
    expect(screen.getByRole('menuitem', { name: 'Download' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download' }))
    await waitFor(() => expect(saveFileAs).toHaveBeenCalledTimes(2))
  })

  it('starts a system file drag from the picture', () => {
    const startDrag = vi.fn()
    Object.assign(window.app, { startDrag })
    render(
      <ImageInteractive savedPath="/tmp/cat.png" onOpen={() => {}} className="" ariaLabel="cat">
        <img alt="cat" />
      </ImageInteractive>,
    )
    fireEvent.dragStart(screen.getByRole('button', { name: 'cat' }))
    expect(startDrag).toHaveBeenCalledWith(['/tmp/cat.png'])
  })
})
