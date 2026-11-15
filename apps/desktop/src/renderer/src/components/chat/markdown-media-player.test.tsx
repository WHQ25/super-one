/** @vitest-environment jsdom */

import type { ReactElement } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/stores/app'
import { chatInputAPI } from './chat-input-api'
import { MarkdownVideoPlayer, videoSelectionMarkdown } from './markdown-media-player'

const CLIP = '/proj/clips/demo.mp4'

beforeEach(() => {
  useAppStore.setState({ currentFolder: '/proj', liquidGlass: false, _worktrees: {} })
  chatInputAPI.insertMention = vi.fn()
})

function videoOf(ui: ReactElement): HTMLVideoElement {
  const { container } = render(ui)
  const video = container.querySelector('video')
  if (!video) throw new Error('missing video')
  return video
}

describe('videoSelectionMarkdown', () => {
  it('brackets a path that would break the destination', () => {
    expect(videoSelectionMarkdown('walk through', '/clips/demo clip.mp4')).toBe('![walk through](</clips/demo clip.mp4>)')
    expect(videoSelectionMarkdown('walkthrough', CLIP)).toBe(`![walkthrough](${CLIP})`)
  })
})

describe('markdown video player', () => {
  it('saves, reveals, mentions, and copies the local file', async () => {
    const saveFileAs = vi.fn<Window['app']['saveFileAs']>().mockResolvedValue({ ok: true, savedPath: '/out/demo.mp4' })
    const revealFile = vi.fn()
    const clipboardWrite = vi.fn().mockResolvedValue(undefined)
    Object.assign(window.app, { saveFileAs, revealFile, clipboardWrite })
    const video = videoOf(
      <MarkdownVideoPlayer src="http://127.0.0.1/demo.mp4" filePath={CLIP} copyText={videoSelectionMarkdown('walkthrough', CLIP)} />,
    )

    fireEvent.contextMenu(video)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Save As' }))
    await waitFor(() => expect(saveFileAs).toHaveBeenCalledWith(CLIP, 'demo.mp4', '/proj'))

    fireEvent.contextMenu(video)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open Folder' }))
    expect(revealFile).toHaveBeenCalledWith(CLIP)

    fireEvent.contextMenu(video)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add to Chat' }))
    expect(chatInputAPI.insertMention).toHaveBeenCalledWith('file', 'clips/demo.mp4', 'demo.mp4')

    fireEvent.contextMenu(video)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy Path' }))
    await waitFor(() => expect(clipboardWrite).toHaveBeenCalledWith(CLIP))

    const root = video.closest('[data-slot="markdown-video"]')
    expect(root?.getAttribute('data-copy-text')).toBe(`![walkthrough](${CLIP})`)
    expect(root?.querySelector('[data-media-player-chrome]')).not.toBeNull()
  })

  it('leaves a stream with no local file menu-less', () => {
    const video = videoOf(<MarkdownVideoPlayer src="https://example.com/clip.mp4" />)
    fireEvent.contextMenu(video)
    expect(screen.queryByRole('menuitem', { name: 'Save As' })).toBeNull()
    expect(video.closest('[data-slot="markdown-video"]')?.hasAttribute('data-copy-text')).toBe(false)
  })

  it('drags the file out and does not treat the drag release as play', () => {
    const startDrag = vi.fn()
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    Object.assign(window.app, { startDrag })
    const video = videoOf(<MarkdownVideoPlayer src="http://127.0.0.1/demo.mp4" filePath={CLIP} />)

    fireEvent.dragStart(video)
    expect(startDrag).toHaveBeenCalledWith([CLIP])
    document.dispatchEvent(new MouseEvent('mouseup'))
    fireEvent.click(video)
    expect(play).not.toHaveBeenCalled()
  })
})
