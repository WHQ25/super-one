/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FileChip } from './FileChip'
import { MentionChip } from './MentionChip'
import { UserTextBlock } from './ChatMessage'
import { wrapPathRefMention } from '@superone/shared/miniapp-prompt-tags'
import type { NodeViewProps } from '@tiptap/react'
import { useAppStore } from '@/stores/app'
import { openFileTab } from '@/components/activity/activity-panel-api'
vi.mock('@/components/activity/activity-panel-api', async (original) => ({
  ...(await original<Record<string, unknown>>()), openFileTab: vi.fn(),
}))
for (const kind of ['file chip', 'composer mention', 'sent mention'] as const) {
  describe(`${kind} image preview`, () => {
    it('opens the viewer from the preview while file clicks still open FileTab', async () => {
      useAppStore.setState({ currentFolder: '/project', _worktrees: {} })
      vi.mocked(openFileTab).mockClear()
      const startDrag = vi.fn()
      window.app.startDrag = startDrag
      const { container } = render(kind === 'file chip'
        ? <FileChip name="photo.png" title="photo.png" filePath="/project/photo.png" />
        : kind === 'composer mention'
          ? <MentionChip {...({ node: { attrs: { kind: 'file', value: 'photo.png', displayName: 'photo.png' } } } as unknown as NodeViewProps)} />
          : <UserTextBlock text={wrapPathRefMention('file', 'photo.png', 'photo.png')} />)
      const thumbnail = container.querySelector('img')!
      expect(thumbnail).toHaveAttribute('draggable', 'false')
      expect(thumbnail.closest('[draggable="true"]')).not.toBeNull()
      fireEvent.click(screen.getByRole('button'))
      expect(openFileTab).toHaveBeenCalledWith('photo.png')
      vi.mocked(openFileTab).mockClear()
      fireEvent.pointerEnter(thumbnail.parentElement!, { pointerType: 'mouse' })
      await waitFor(() => expect(screen.getByAltText('photo.png')).toBeInTheDocument())
      fireEvent.mouseDown(thumbnail)
      await waitFor(() => expect(screen.queryByAltText('photo.png')).toBeNull())
      fireEvent.dragStart(thumbnail.closest('[draggable="true"]')!)
      expect(startDrag).toHaveBeenCalledWith(['/project/photo.png'])
      fireEvent.mouseUp(document)
      fireEvent.mouseLeave(thumbnail.parentElement!.parentElement!)
      fireEvent.pointerLeave(thumbnail.parentElement!, { pointerType: 'mouse' })
      fireEvent.pointerEnter(thumbnail.parentElement!, { pointerType: 'mouse' })
      await waitFor(() => expect(screen.getByAltText('photo.png')).toBeInTheDocument())
      const preview = screen.getByAltText('photo.png').closest('button')!
      fireEvent.mouseDown(preview)
      expect(preview).toBeInTheDocument()
      fireEvent.mouseUp(preview)
      fireEvent.click(preview)
      expect(await screen.findByRole('dialog')).toBeInTheDocument()
      expect(openFileTab).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: 'Close' }))
      expect(openFileTab).not.toHaveBeenCalled()
    })
  })
}

it('falls back to a file icon when an image cannot load', () => {
  const { container } = render(<FileChip name="missing.png" title="missing.png" filePath="missing.png" />)
  const thumbnail = container.querySelector('img')!
  fireEvent.error(thumbnail)
  expect(container).not.toContainElement(thumbnail)
  expect(container.querySelector('[draggable="true"]')).not.toBeNull()
})

it('sends a drag preview containing the loaded thumbnail and actual filename', () => {
  const drawImage = vi.fn()
  const fillText = vi.fn()
  const context = new Proxy({ drawImage, fillText, measureText: () => ({ width: 70 }) }, {
    get: (target, key) => key in target ? target[key as keyof typeof target] : () => {},
  }) as unknown as CanvasRenderingContext2D
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
  const toDataURL = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,cG5n')
  try {
    const startDrag = vi.fn()
    window.app.startDrag = startDrag
    const { container } = render(<FileChip name="Design reference" title="photo.png" filePath="/project/photo.png" />)
    const thumbnail = container.querySelector('img[data-file-thumbnail]')!
    Object.defineProperties(thumbnail, {
      complete: { value: true }, naturalWidth: { value: 160 }, naturalHeight: { value: 80 },
    })
    fireEvent.mouseDown(thumbnail)
    fireEvent.dragStart(thumbnail.closest('[draggable="true"]')!)
    expect(drawImage).toHaveBeenCalledWith(thumbnail, 12, 16, 32, 16)
    expect(fillText).toHaveBeenCalledWith('photo.png', 50, 24)
    expect(startDrag).toHaveBeenCalledWith(['/project/photo.png'], {
      png: expect.any(ArrayBuffer), scaleFactor: window.devicePixelRatio || 1,
    })
    toDataURL.mockImplementation(() => { throw new DOMException('Tainted canvas', 'SecurityError') })
    startDrag.mockClear()
    fireEvent.dragStart(thumbnail.closest('[draggable="true"]')!)
    expect(startDrag).toHaveBeenCalledWith(['/project/photo.png'])
    fireEvent.mouseUp(document)
  } finally {
    getContext.mockRestore()
    toDataURL.mockRestore()
  }
})
