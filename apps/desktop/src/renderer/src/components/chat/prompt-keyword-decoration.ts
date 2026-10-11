/**
 * Paints the prompt keywords the session's harness acts on
 * (`HarnessCapabilities.promptKeywords`) the way Claude Code's own prompt input
 * does, letter by letter with a shimmer sweeping across: `ultrathink` in its
 * rainbow, `ultracode` in its purple (`.prompt-keyword-*` in `@superone/ui/styles/prompt-keyword.css`).
 */

import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { findPromptKeywords, type PromptKeyword } from '@superone/shared/prompt-keywords'
import { promptKeywordLetterVars } from '@superone/ui/components/ui/prompt-keyword-text'
import { draftText } from './composer-draft-text'

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

function letterStyle(keyword: PromptKeyword, index: number): string {
  return Object.entries(promptKeywordLetterVars(keyword, index)).map(([name, value]) => `${name}: ${value}`).join('; ')
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
