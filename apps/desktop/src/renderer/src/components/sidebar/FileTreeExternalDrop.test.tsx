/** @vitest-environment jsdom */

import { createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/stores/app'
import { useFileTreeStore } from '@/stores/file-tree'
import { FileTree } from './FileTree'

const listDir = vi.fn(async () => [])
const fileDrag = { dataTransfer: { types: ['Files'] } }

// jsdom ships no `DragEvent`, so testing-library falls back to `Event` and silently drops
// `relatedTarget` from the init — the very field the leave logic reads. Define it by hand.
function dragLeave(target: Element, relatedTarget: Node | null) {
  const event = createEvent.dragLeave(target, fileDrag)
  Object.defineProperty(event, 'relatedTarget', { value: relatedTarget })
  fireEvent(target, event)
}

function stubApp() {
  const w = globalThis.window as unknown as Record<string, unknown>
  w.app = { listDir, trace: vi.fn() }
}

async function renderTree() {
  useAppStore.setState({ currentFolder: '/Users/me/proj' })
  render(<FileTree />)
  await waitFor(() => expect(listDir).toHaveBeenCalled())
  return screen.getByTestId('file-tree-dropzone')
}

describe('file tree external drop overlay', () => {
  beforeEach(() => {
    listDir.mockClear()
    stubApp()
    useFileTreeStore.getState().reset()
  })

  it('shows a single drop hint while external files hover the tree', async () => {
    const dropZone = await renderTree()

    fireEvent.dragEnter(dropZone, fileDrag)

    expect(screen.getByText(/Copy to/)).toBeInTheDocument()
  })

  it('retires the hint when the drag hands off to a node outside the tree', async () => {
    const dropZone = await renderTree()
    fireEvent.dragEnter(dropZone, fileDrag)

    dragLeave(dropZone, document.body)

    expect(screen.queryByText(/Copy to/)).not.toBeInTheDocument()
  })

  it('keeps the hint while the drag only moves between rows inside the tree', async () => {
    const dropZone = await renderTree()
    fireEvent.dragEnter(dropZone, fileDrag)

    dragLeave(dropZone, dropZone.firstElementChild!)

    expect(screen.getByText(/Copy to/)).toBeInTheDocument()
  })

  // Rows unmount mid-drag (virtualizer scroll, auto-expand) and swallow their own
  // `dragleave`, so leaving the tree used to strand the overlay forever.
  it('retires the hint when the drag surfaces outside the tree without a dragleave', async () => {
    const dropZone = await renderTree()
    fireEvent.dragEnter(dropZone, fileDrag)

    fireEvent.dragOver(document.body, fileDrag)

    expect(screen.queryByText(/Copy to/)).not.toBeInTheDocument()
  })

  it('retires the hint when the drag leaves the window entirely', async () => {
    const dropZone = await renderTree()
    fireEvent.dragEnter(dropZone, fileDrag)

    dragLeave(document.body, null)

    expect(screen.queryByText(/Copy to/)).not.toBeInTheDocument()
  })
})
