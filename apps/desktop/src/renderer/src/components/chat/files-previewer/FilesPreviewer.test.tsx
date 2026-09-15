/** @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeWidgetPayload, PreviewerFile } from '@superone/shared/generative-ui/native-widgets'
import { FilesPreviewer } from './FilesPreviewer'

/**
 * The card is a stage, not a workspace: arrows and dots move between files,
 * every click on the stage opens the fullscreen, and nothing inside a slide
 * can act on its own. `window.app` is the only boundary mocked.
 */
const ROOT = '/repo'
const image: PreviewerFile = { path: 'docs/diagram.png', absolutePath: '/repo/docs/diagram.png', name: 'diagram.png', kind: 'image', size: 10, note: 'Three layers' }
const text: PreviewerFile = { path: 'src/a.ts', absolutePath: '/repo/src/a.ts', name: 'a.ts', kind: 'text', size: 20, note: 'Entry point' }
const missing: PreviewerFile = { path: 'gone.md', absolutePath: '/repo/gone.md', name: 'gone.md', kind: 'missing', note: 'Not yet written' }
const clip: PreviewerFile = { path: 'demo.mp4', absolutePath: '/repo/demo.mp4', name: 'demo.mp4', kind: 'video', size: 30 }

function payload(files: PreviewerFile[]): NativeWidgetPayload {
  return { kind: 'native', nativeType: 'files-previewer', title: 't', root: ROOT, files }
}

const readProjectFile = vi.fn()
const statPreviewFile = vi.fn()

beforeEach(() => {
  readProjectFile.mockReset().mockImplementation((_root: string, path: string) =>
    Promise.resolve({ path, content: `// contents of ${path}\n`, language: 'typescript' }))
  statPreviewFile.mockReset()
  Object.assign(window.app, { readProjectFile, statPreviewFile })
})

const card = () => screen.getByTestId('files-previewer')
const stage = () => screen.getByTestId('previewer-stage')

describe('files previewer card — remote sessions', () => {
  const REMOTE_ROOT = 'remote:conn-1:/home/node/proj'
  const nodeShot: PreviewerFile = {
    path: '/home/node/.superone/node/sync/s1/browser/shot.png',
    absolutePath: '/home/node/.superone/node/sync/s1/browser/shot.png',
    name: 'shot.png',
    kind: 'image',
    size: 12,
    note: 'the result',
  }

  it('loads a node media file through readProjectFile as a data URI instead of a file path', async () => {
    // The main process serves the mirror/artifact bytes back as a data: URI.
    readProjectFile.mockResolvedValue({
      path: nodeShot.absolutePath,
      content: 'data:image/png;base64,aW1n',
      language: 'image',
    })
    render(<FilesPreviewer payload={{ kind: 'native', nativeType: 'files-previewer', title: 't', root: REMOTE_ROOT, files: [nodeShot] }} />)
    const img = await screen.findByAltText('shot.png')
    expect(img).toHaveAttribute('src', 'data:image/png;base64,aW1n')
    // It went through readProjectFile with the remote root, never a bare file:// URL.
    expect(readProjectFile).toHaveBeenCalledWith(REMOTE_ROOT, nodeShot.absolutePath)
  })
})

describe('files previewer card', () => {
  it('shows the first file with its note, counter and kind, and only reads the slide it shows', async () => {
    render(<FilesPreviewer payload={payload([image, text, missing])} />)
    expect(screen.getByTestId('previewer-counter').textContent).toBe('1 / 3')
    expect(screen.getByTestId('previewer-note').textContent).toBe('Three layers')
    expect(stage().querySelector('img')?.getAttribute('src')).toContain('diagram.png')
    // An image is a URL, not a read; the text slide is not current, so nothing was read yet.
    expect(readProjectFile).not.toHaveBeenCalled()
  })

  it('moves with the arrows and dots and reads the text slide once it is current', async () => {
    render(<FilesPreviewer payload={payload([image, text, missing])} />)
    fireEvent.click(screen.getByLabelText('Next file'))
    expect(screen.getByTestId('previewer-counter').textContent).toBe('2 / 3')
    await waitFor(() => expect(readProjectFile).toHaveBeenCalledWith(ROOT, '/repo/src/a.ts'))
    expect(screen.getByTestId('previewer-note').textContent).toBe('Entry point')

    fireEvent.click(screen.getByLabelText('3'))
    expect(screen.getByTestId('previewer-counter').textContent).toBe('3 / 3')
    expect(screen.getByLabelText('Next file')).toBeDisabled()
  })

  it('answers ← → only while the card has focus', () => {
    render(<FilesPreviewer payload={payload([image, text])} />)
    // Keys on the document (the composer's territory) do nothing.
    fireEvent.keyDown(document.body, { key: 'ArrowRight' })
    expect(card().dataset.index).toBe('0')

    card().focus()
    fireEvent.keyDown(card(), { key: 'ArrowRight' })
    expect(card().dataset.index).toBe('1')
    fireEvent.keyDown(card(), { key: 'ArrowRight' })
    expect(card().dataset.index).toBe('1')
    fireEvent.keyDown(card(), { key: 'ArrowLeft' })
    expect(card().dataset.index).toBe('0')
  })

  it('renders a single file without arrows, dots or a counter', () => {
    render(<FilesPreviewer payload={payload([image])} />)
    expect(screen.queryByTestId('previewer-counter')).toBeNull()
    expect(screen.queryByTestId('previewer-dots')).toBeNull()
    expect(screen.queryByLabelText('Next file')).toBeNull()
  })

  it('opens the fullscreen on a stage click but not on a media control bar', () => {
    render(<FilesPreviewer payload={payload([clip, image])} />)
    // The video's native controls are the one interactive thing a card keeps.
    fireEvent.click(stage().querySelector('video')!)
    expect(screen.queryByTestId('previewer-fullscreen')).toBeNull()

    fireEvent.click(stage())
    expect(screen.getByTestId('previewer-fullscreen')).toBeInTheDocument()
  })

  it('shows the missing state and swaps the row in when a retry finds the file', async () => {
    statPreviewFile.mockResolvedValue({ ...missing, kind: 'markdown', size: 6 })
    readProjectFile.mockResolvedValue({ path: 'gone.md', content: '# now\n', language: 'markdown' })
    render(<FilesPreviewer payload={payload([missing])} />)
    expect(screen.getByTestId('previewer-error').textContent).toContain('File not found')

    await act(async () => { fireEvent.click(screen.getByText('Retry')) })
    // Re-stat by the absolute path: a remote root has no cwd to resolve 'gone.md' against.
    await waitFor(() => expect(statPreviewFile).toHaveBeenCalledWith(ROOT, '/repo/gone.md'))
    await waitFor(() => expect(screen.queryByTestId('previewer-error')).toBeNull())
    // The note survives the re-stat; the host does not know it.
    expect(screen.getByTestId('previewer-note').textContent).toBe('Not yet written')
    await waitFor(() => expect(readProjectFile).toHaveBeenCalledWith(ROOT, '/repo/gone.md'))
  })

  it('flips an image that fails to decode into the error state without a host round trip', () => {
    render(<FilesPreviewer payload={payload([image])} />)
    fireEvent.error(stage().querySelector('img')!)
    expect(screen.getByTestId('previewer-error').textContent).toContain('Cannot be displayed')
    expect(statPreviewFile).not.toHaveBeenCalled()
  })

  it('keeps the fullscreen and the card on the same file', () => {
    render(<FilesPreviewer payload={payload([image, text, clip])} />)
    fireEvent.click(screen.getByLabelText('Next file'))
    fireEvent.click(stage())
    const fullscreen = screen.getByTestId('previewer-fullscreen')
    expect(fullscreen.textContent).toContain('2 / 3')

    // The fullscreen dots jump; closing leaves the card there.
    fireEvent.click(within(fullscreen).getByLabelText('3'))
    expect(fullscreen.textContent).toContain('3 / 3')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(card().dataset.index).toBe('2')
  })
})
