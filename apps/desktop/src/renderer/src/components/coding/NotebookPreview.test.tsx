/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NotebookPreview } from './NotebookPreview'
import { VIRTUALIZE_MIN_CELLS } from './notebook-codec'

// jsdom has no layout engine, so the virtualizer sizes its viewport at 0 and
// mounts nothing. It measures the scroll container with `offsetHeight` and each
// row with `getBoundingClientRect`, so both need a value for the windowing math
// to be real.
const VIEWPORT_PX = 600
const ROW_PX = 40
let rectSpy: ReturnType<typeof vi.spyOn>

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: VIEWPORT_PX })
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 })
  rectSpy = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockReturnValue({ ...new DOMRect(0, 0, 800, ROW_PX), toJSON: () => ({}) } as DOMRect)
})
afterAll(() => {
  rectSpy.mockRestore()
  Reflect.deleteProperty(HTMLElement.prototype, 'offsetHeight')
  Reflect.deleteProperty(HTMLElement.prototype, 'offsetWidth')
})

function notebookWithCodeCells(count: number): string {
  return JSON.stringify({
    nbformat: 4,
    metadata: { language_info: { name: 'python' } },
    cells: Array.from({ length: count }, (_, i) => ({
      cell_type: 'code',
      execution_count: i + 1,
      source: `print(${i})`,
      outputs: [],
    })),
  })
}

const gutters = () => screen.queryAllByText(/^In \[\d+\]:$/)

describe('notebook preview rendering strategy', () => {
  it('renders every cell directly for a notebook below the virtualization threshold', async () => {
    const count = VIRTUALIZE_MIN_CELLS - 1
    render(<NotebookPreview content={notebookWithCodeCells(count)} />)
    await waitFor(() => expect(gutters().length).toBeGreaterThan(0))
    expect(gutters()).toHaveLength(count)
  })

  it('mounts only a window of cells once the notebook crosses the threshold', async () => {
    const count = VIRTUALIZE_MIN_CELLS * 4
    render(<NotebookPreview content={notebookWithCodeCells(count)} />)
    await waitFor(() => expect(gutters().length).toBeGreaterThan(0))
    // The point of the change: a big notebook must not put every cell in the DOM.
    expect(gutters().length).toBeLessThan(count)
    // The first cell is always in the mounted window.
    expect(screen.getByText('In [1]:')).toBeInTheDocument()
  })

  it('keeps the invalid-notebook fallback regardless of size', () => {
    render(<NotebookPreview content="{ broken" />)
    expect(screen.getByText(/Not a valid notebook/)).toBeInTheDocument()
  })
})

