import { Extension, getTextBetween, getTextSerializersFromSchema, type Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { ModDecoration } from '@superone/shared/mod-ui'
import { decorationStyle, type PromptEditAnswer } from '@superone/chat-view/mod-ui'
import { plainTextToTiptapDoc } from './plainTextToTiptapDoc'

const key = new PluginKey<DecorationSet>('modPromptDecoration')

/** Length of the composer's plain text (`editor.getText()`) before `pos`. */
function textLengthBefore(editor: Editor, pos: number): number {
  const { doc, schema } = editor.state
  return getTextBetween(doc, { from: 0, to: pos }, { textSerializers: getTextSerializersFromSchema(schema) }).length
}

/** The document position where the plain text reaches `offset` characters. */
export function positionAtTextOffset(editor: Editor, offset: number): number {
  let lo = 0
  let hi = editor.state.doc.content.size
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (textLengthBefore(editor, mid) < offset) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** The caret as a plain-text offset, the unit plugins read and write. */
export function caretTextOffset(editor: Editor): number {
  return textLengthBefore(editor, editor.state.selection.head)
}

/** Shows a plugin's decoration runs until the next edit. */
export function setModPromptDecorations(editor: Editor, runs: ModDecoration[]): void {
  const decorations = runs
    .filter((r) => r.end > r.start)
    .map((r) => Decoration.inline(positionAtTextOffset(editor, r.start), positionAtTextOffset(editor, r.end), { style: decorationStyle(r) }))
  editor.view.dispatch(editor.state.tr.setMeta(key, DecorationSet.create(editor.state.doc, decorations)))
}

const PLAIN_NODES = new Set(['doc', 'paragraph', 'text', 'hardBreak'])

/** Whether the draft is text only: no mention, attachment or paste chip a rewrite would drop. */
function isPlainDraft(editor: Editor): boolean {
  let plain = true
  editor.state.doc.descendants((node) => {
    if (!PLAIN_NODES.has(node.type.name)) plain = false
    return plain
  })
  return plain
}

/**
 * Shows a plugin's `prompt.edit` answer: its text and caret, then its runs.
 * A draft holding chips keeps its text (a plain-text rewrite would drop
 * them); only matching runs paint. Returns whether the text was rewritten.
 */
export function applyModPromptEdit(editor: Editor, answer: PromptEditAnswer): boolean {
  const rewrite = answer.text !== editor.getText()
  if (rewrite) {
    if (!isPlainDraft(editor)) return false
    editor.chain().setContent(plainTextToTiptapDoc(answer.text), { emitUpdate: true }).setTextSelection(positionAtTextOffset(editor, answer.cursor)).run()
  } else if (answer.cursor !== caretTextOffset(editor)) {
    editor.commands.setTextSelection(positionAtTextOffset(editor, answer.cursor))
  }
  setModPromptDecorations(editor, answer.decorations ?? [])
  return rewrite
}

/**
 * Colors a mod laid over the composer's text (`$.prompt.fill` decorations).
 * They are transient, as in the terminal: the next edit clears them.
 */
export const ModPromptDecoration = Extension.create({
  name: 'modPromptDecoration',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, set) => tr.getMeta(key) ?? (tr.docChanged ? DecorationSet.empty : set),
        },
        props: { decorations: (state) => key.getState(state) },
      }),
    ]
  },
})
