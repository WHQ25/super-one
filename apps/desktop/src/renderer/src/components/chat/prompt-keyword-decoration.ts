/**
 * Paints the prompt keywords the session's harness acts on
 * (`HarnessCapabilities.promptKeywords`) the way Claude Code's own prompt input
 * does, letter by letter with a shimmer sweeping across: `ultrathink` in its
 * rainbow, `ultracode` in its purple (`.prompt-keyword-*` in index.css).
 */

import { Extension, type Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { findPromptKeywords, type PromptKeyword } from '@superone/shared/prompt-keywords'

// Claude Code's `rainbow_*` and `rainbow_*_shimmer` theme colours, assigned by
// letter index and wrapping after violet: `--ultrathink-N` in index.css.
const RAINBOW_LENGTH = 7

export interface PromptKeywordDecorationOptions {
  keywords: readonly PromptKeyword[]
}

export interface PromptKeywordDecorationStorage {
  keywords: readonly PromptKeyword[]
}

declare module '@tiptap/core' {
  interface Storage {
    promptKeywordDecoration: PromptKeywordDecorationStorage
  }
}

/**
 * The draft as one string, the way the keyword scan sees the sent prompt:
 * paragraphs and hard breaks are newlines, a chip is one non-word character.
 * `positions[i]` is the document position of `text[i]`, or -1 off the text.
 */
function draftText(doc: PMNode): { text: string; positions: number[] } {
  let text = ''
  const positions: number[] = []
  doc.forEach((block, blockOffset) => {
    if (text) { text += '\n'; positions.push(-1) }
    block.forEach((child, childOffset) => {
      const pos = blockOffset + 1 + childOffset
      if (child.isText && child.text) {
        text += child.text
        for (let i = 0; i < child.text.length; i++) positions.push(pos + i)
      } else {
        text += child.type.name === 'hardBreak' ? '\n' : '￼'
        positions.push(-1)
      }
    })
  })
  return { text, positions }
}

function letterStyle(keyword: PromptKeyword, index: number): string {
  if (keyword !== 'ultrathink') return `--kw-index: ${index}`
  const hue = index % RAINBOW_LENGTH
  return `--kw-color: rgb(var(--ultrathink-${hue})); --kw-shimmer: rgb(var(--ultrathink-shimmer-${hue})); --kw-index: ${index}`
}

export const PromptKeywordDecoration = Extension.create<PromptKeywordDecorationOptions, PromptKeywordDecorationStorage>({
  name: 'promptKeywordDecoration',

  addOptions() {
    return { keywords: [] }
  },

  addStorage() {
    return { keywords: this.options.keywords }
  },

  addProseMirrorPlugins() {
    const storage = this.storage
    return [
      new Plugin({
        key: new PluginKey('promptKeywordDecoration'),
        props: {
          decorations(state) {
            if (storage.keywords.length === 0) return DecorationSet.empty
            const { text, positions } = draftText(state.doc)
            const decorations: Decoration[] = []
            for (const match of findPromptKeywords(text, storage.keywords)) {
              // One span per letter: each carries its own colour and shimmer slot.
              for (let i = match.start; i < match.end; i++) {
                const pos = positions[i]!
                decorations.push(Decoration.inline(pos, pos + 1, {
                  class: `prompt-keyword-${match.keyword}`,
                  style: letterStyle(match.keyword, i - match.start),
                  // A keyword is not a misspelling; the rest of the draft keeps spellcheck.
                  spellcheck: 'false',
                }))
              }
            }
            return DecorationSet.create(state.doc, decorations)
          },
        },
      }),
    ]
  },
})

export function syncPromptKeywords(editor: Editor | null | undefined, keywords: readonly PromptKeyword[]): void {
  if (!editor || editor.isDestroyed) return
  const storage = editor.storage.promptKeywordDecoration as PromptKeywordDecorationStorage | undefined
  if (!storage || storage.keywords === keywords) return
  storage.keywords = keywords
  editor.view.dispatch(editor.state.tr)
}
