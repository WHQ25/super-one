/** @vitest-environment jsdom */
import { Editor, type JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, expect, it } from 'vitest'
import { ModPromptDecoration, caretTextOffset, positionAtTextOffset, setModPromptDecorations } from './mod-prompt-decoration'

let editor: Editor | null = null
afterEach(() => editor?.destroy())

function make(content: JSONContent) {
  editor = new Editor({ extensions: [StarterKit, ModPromptDecoration], content })
  return editor
}

const lines = (...parts: string[]): JSONContent => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: parts.flatMap((text, i) => (i === 0 ? [{ type: 'text', text }] : [{ type: 'hardBreak' }, { type: 'text', text }])) }],
})

it('maps plain-text offsets across hard breaks', () => {
  const ed = make(lines('ab', 'cd'))
  expect(ed.getText()).toBe('ab\ncd')
  // "c" is the fourth character: after "ab" and the break.
  const pos = positionAtTextOffset(ed, 3)
  expect(ed.state.doc.textBetween(pos, pos + 1)).toBe('c')
})

it('reports the caret as a plain-text offset', () => {
  const ed = make(lines('hello'))
  ed.commands.setTextSelection(4)
  expect(caretTextOffset(ed)).toBe(3)
})

it('paints decoration runs until the next edit', () => {
  const ed = make(lines('filled by probe'))
  setModPromptDecorations(ed, [{ start: 0, end: 6, color: 'red', bold: true }])
  const span = ed.view.dom.querySelector('span[style]')
  expect(span?.textContent).toBe('filled')
  expect(span?.getAttribute('style')).toMatch(/font-weight:\s*600/)
  ed.commands.insertContent('!')
  expect(ed.view.dom.querySelector('span[style]')).toBeNull()
})
