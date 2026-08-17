import { describe, expect, it } from 'vitest'
import {
  estimateCellHeight,
  parseNotebook,
  type NotebookCell,
  type NotebookOutput,
} from './notebook-codec'

function nb(extra: Record<string, unknown>): string {
  return JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [], ...extra })
}

describe('notebook parsing', () => {
  it('returns null when the file is not a notebook', () => {
    expect(parseNotebook('not json at all')).toBeNull()
    expect(parseNotebook('{"foo":1}')).toBeNull()
    expect(parseNotebook(JSON.stringify({ cells: 'nope' }))).toBeNull()
  })

  it('joins array sources into one string and keeps string sources as-is', () => {
    const parsed = parseNotebook(nb({
      cells: [
        { cell_type: 'code', source: ['import os\n', 'print(os.name)\n'], outputs: [], execution_count: 1 },
        { cell_type: 'markdown', source: '# Title\n' },
      ],
    }))
    expect(parsed?.cells[0].source).toBe('import os\nprint(os.name)\n')
    expect(parsed?.cells[1].source).toBe('# Title\n')
  })

  it('reads the kernel language from language_info, then kernelspec, then falls back to python', () => {
    expect(parseNotebook(nb({ metadata: { language_info: { name: 'r' }, kernelspec: { language: 'julia' } } }))?.language).toBe('r')
    expect(parseNotebook(nb({ metadata: { kernelspec: { language: 'julia' } } }))?.language).toBe('julia')
    expect(parseNotebook(nb({ metadata: {} }))?.language).toBe('python')
  })

  it('splits stream output by stdout and stderr', () => {
    const parsed = parseNotebook(nb({
      cells: [{
        cell_type: 'code',
        source: '',
        execution_count: 2,
        outputs: [
          { output_type: 'stream', name: 'stdout', text: ['hello\n', 'world\n'] },
          { output_type: 'stream', name: 'stderr', text: 'warning\n' },
        ],
      }],
    }))
    expect(parsed?.cells[0].outputs).toEqual([
      { kind: 'stream', stream: 'stdout', text: 'hello\nworld\n' },
      { kind: 'stream', stream: 'stderr', text: 'warning\n' },
    ])
  })

  it('prefers a png bundle over text/plain and strips whitespace from the base64 payload', () => {
    const parsed = parseNotebook(nb({
      cells: [{
        cell_type: 'code',
        source: '',
        execution_count: 3,
        outputs: [{
          output_type: 'display_data',
          data: { 'text/plain': '<Figure size 640x480>', 'image/png': 'iVBORw0KG\ngoAAAANS\n' },
        }],
      }],
    }))
    expect(parsed?.cells[0].outputs).toEqual([
      { kind: 'image', mime: 'image/png', src: 'data:image/png;base64,iVBORw0KGgoAAAANS' },
    ])
  })

  it('renders an svg bundle as a percent-encoded data url rather than base64', () => {
    const parsed = parseNotebook(nb({
      cells: [{
        cell_type: 'code',
        source: '',
        outputs: [{ output_type: 'execute_result', data: { 'image/svg+xml': ['<svg ', 'width="1"/>'] } }],
      }],
    }))
    expect(parsed?.cells[0].outputs[0]).toEqual({
      kind: 'image',
      mime: 'image/svg+xml',
      src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg width="1"/>')}`,
    })
  })

  it('degrades an html-only bundle to text/plain instead of rendering the html', () => {
    const parsed = parseNotebook(nb({
      cells: [{
        cell_type: 'code',
        source: '',
        outputs: [{
          output_type: 'execute_result',
          data: { 'text/html': '<script>alert(1)</script><table>…</table>', 'text/plain': '   a  b\n0  1  2' },
        }],
      }],
    }))
    expect(parsed?.cells[0].outputs).toEqual([{ kind: 'text', text: '   a  b\n0  1  2' }])
  })

  it('drops an output whose only representation is html', () => {
    const parsed = parseNotebook(nb({
      cells: [{
        cell_type: 'code',
        source: '',
        outputs: [{ output_type: 'execute_result', data: { 'text/html': '<b>hi</b>' } }],
      }],
    }))
    expect(parsed?.cells[0].outputs).toEqual([])
  })

  it('strips ansi escapes from an error traceback', () => {
    const parsed = parseNotebook(nb({
      cells: [{
        cell_type: 'code',
        source: '',
        outputs: [{
          output_type: 'error',
          ename: 'ValueError',
          evalue: 'bad',
          traceback: ['[0;31mValueError[0m: bad', '[1;32m  at line 3[0m'],
        }],
      }],
    }))
    expect(parsed?.cells[0].outputs).toEqual([
      { kind: 'error', text: 'ValueError: bad\n  at line 3' },
    ])
  })

  it('falls back to ename and evalue when an error carries no traceback', () => {
    const parsed = parseNotebook(nb({
      cells: [{ cell_type: 'code', source: '', outputs: [{ output_type: 'error', ename: 'KeyError', evalue: "'x'" }] }],
    }))
    expect(parsed?.cells[0].outputs).toEqual([{ kind: 'error', text: "KeyError: 'x'" }])
  })

  it('keeps execution_count and tolerates missing cell fields', () => {
    const parsed = parseNotebook(nb({
      cells: [{ cell_type: 'code' }, { cell_type: 'markdown', source: 'x' }, { source: 'raw text' }],
    }))
    expect(parsed?.cells).toHaveLength(3)
    expect(parsed?.cells[0]).toMatchObject({ type: 'code', source: '', executionCount: null, outputs: [] })
    expect(parsed?.cells[2].type).toBe('raw')
  })
})

describe('cell height estimation', () => {
  const code = (source: string, outputs: NotebookOutput[] = []): NotebookCell => ({
    type: 'code',
    source,
    executionCount: 1,
    outputs,
  })

  it('always estimates a positive height, even for an empty cell', () => {
    expect(estimateCellHeight(code(''))).toBeGreaterThan(0)
    expect(estimateCellHeight({ type: 'markdown', source: '', executionCount: null, outputs: [] })).toBeGreaterThan(0)
  })

  it('grows with the number of source lines', () => {
    expect(estimateCellHeight(code('a\nb\nc\nd\ne'))).toBeGreaterThan(estimateCellHeight(code('a')))
  })

  it('counts outputs on top of the source', () => {
    const bare = estimateCellHeight(code('x = 1'))
    const withStream = estimateCellHeight(code('x = 1', [{ kind: 'stream', stream: 'stdout', text: 'a\nb\nc' }]))
    expect(withStream).toBeGreaterThan(bare)
  })

  it('treats an image output as far taller than a one-line text output', () => {
    const withText = estimateCellHeight(code('p()', [{ kind: 'text', text: 'ok' }]))
    const withImage = estimateCellHeight(code('p()', [{ kind: 'image', mime: 'image/png', src: 'data:image/png;base64,AA' }]))
    expect(withImage).toBeGreaterThan(withText * 2)
  })

  it('caps a runaway output so one noisy cell cannot skew the scrollbar', () => {
    const huge = estimateCellHeight(code('x', [{ kind: 'stream', stream: 'stdout', text: 'line\n'.repeat(5000) }]))
    expect(huge).toBeLessThan(2000)
  })
})

describe('height estimation accounts for wrapping', () => {
  const longLine = (n: number): NotebookCell => ({
    type: 'code',
    source: 'x'.repeat(n),
    executionCount: 1,
    outputs: [],
  })

  it('estimates a long unbroken line as taller in a narrow column than a wide one', () => {
    const narrow = estimateCellHeight(longLine(400), 40)
    const wide = estimateCellHeight(longLine(400), 200)
    expect(narrow).toBeGreaterThan(wide)
  })

  it('does not inflate a line that already fits the column', () => {
    expect(estimateCellHeight(longLine(10), 40)).toBe(estimateCellHeight(longLine(10), 200))
  })

  it('counts a wrapped line roughly like the equivalent number of hard-wrapped lines', () => {
    const wrapped = estimateCellHeight(longLine(160), 40)
    const hard = estimateCellHeight(
      { type: 'code', source: 'x'.repeat(40) + '\n' + 'x'.repeat(40) + '\n' + 'x'.repeat(40) + '\n' + 'x'.repeat(40), executionCount: 1, outputs: [] },
      40,
    )
    expect(wrapped).toBe(hard)
  })

  it('stays positive and finite for a degenerate column width', () => {
    expect(estimateCellHeight(longLine(100), 0)).toBeGreaterThan(0)
    expect(Number.isFinite(estimateCellHeight(longLine(100), 0))).toBe(true)
  })
})
