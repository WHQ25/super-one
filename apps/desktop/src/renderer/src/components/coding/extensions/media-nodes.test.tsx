/** @vitest-environment jsdom */

import { render, screen, waitFor } from '@testing-library/react'
import { EditorContent, useEditor } from '@tiptap/react'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from '@/stores/app'
import { MediaBaseDirProvider, MediaImageNode, RawMediaNode } from './media-nodes'

function Harness({ baseDir, content }: { baseDir: string; content: string }) {
  const editor = useEditor({
    extensions: [Document, Paragraph, Text, MediaImageNode, RawMediaNode],
    content,
  })
  return (
    <MediaBaseDirProvider value={baseDir}>
      <EditorContent editor={editor} />
    </MediaBaseDirProvider>
  )
}

describe('markdown editor media node views', () => {
  beforeEach(() => {
    useAppStore.setState({ currentFolder: '/Users/foo/super-one', _worktrees: {} })
  })

  it('resolves a relative image against the markdown file directory, not the project root', async () => {
    render(<Harness baseDir="docs/report" content='<p><img src="assets/cat.png" alt="a cat"></p>' />)
    const img = await screen.findByAltText('a cat')
    await waitFor(() =>
      expect(img.getAttribute('src')).toBe('local-file:///Users/foo/super-one/docs/report/assets/cat.png'),
    )
  })

  it('resolves a relative src for a file sitting at the project root', async () => {
    render(<Harness baseDir="" content='<p><img src="assets/cat.png" alt="a cat"></p>' />)
    const img = await screen.findByAltText('a cat')
    await waitFor(() =>
      expect(img.getAttribute('src')).toBe('local-file:///Users/foo/super-one/assets/cat.png'),
    )
  })

  it('leaves a remote image url untouched', async () => {
    render(<Harness baseDir="docs/report" content='<p><img src="https://example.com/a.png" alt="remote"></p>' />)
    const img = await screen.findByAltText('remote')
    await waitFor(() => expect(img.getAttribute('src')).toBe('https://example.com/a.png'))
  })

  it('renders an authored width inline instead of blowing the icon up to full size', async () => {
    render(<Harness baseDir="" content='<p><img src="https://example.com/icon.png" alt="icon" width="16"> Grok</p>' />)
    const img = await screen.findByAltText('icon')
    await waitFor(() => expect(img.getAttribute('width')).toBe('16'))
    // `width: auto` would beat the attribute's presentational hint, and `display:
    // block` would push the label onto its own line.
    expect(img.style.width).toBe('')
    expect(img.style.height).toBe('auto')
    expect(img.style.display).toBe('')
  })

  it('keeps the block preview defaults for a markdown image with no authored size', async () => {
    render(<Harness baseDir="" content='<p><img src="https://example.com/shot.png" alt="shot"></p>' />)
    const img = await screen.findByAltText('shot')
    await waitFor(() => expect(img.style.display).toBe('block'))
    expect(img.style.width).toBe('auto')
  })

  it('renders a raw video tag as a playable video rebased on the file directory', async () => {
    const { container } = render(
      <Harness baseDir="docs/report" content='<p><video src="media/demo.mp4" controls></video></p>' />,
    )
    await waitFor(() => {
      const video = container.querySelector('video')
      expect(video).not.toBeNull()
      expect(video?.getAttribute('src')).toBe('local-file:///Users/foo/super-one/docs/report/media/demo.mp4')
    })
  })

  it('renders a raw audio tag as audio rather than guessing from the extension', async () => {
    const { container } = render(
      <Harness baseDir="docs" content='<p><audio src="take.mp3" controls></audio></p>' />,
    )
    await waitFor(() => {
      const audio = container.querySelector('audio')
      expect(audio?.getAttribute('src')).toBe('local-file:///Users/foo/super-one/docs/take.mp3')
    })
  })

  it('plays the first source child when the raw tag has no src', async () => {
    const { container } = render(
      <Harness
        baseDir="docs"
        content='<p><video controls><source src="a.webm" type="video/webm"><source src="a.mp4" type="video/mp4"></video></p>'
      />,
    )
    await waitFor(() => {
      const video = container.querySelector('video')
      expect(video?.getAttribute('src')).toBe('local-file:///Users/foo/super-one/docs/a.webm')
    })
  })
})
