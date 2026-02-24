import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export interface PromptSuggestionStorage {
  suggestion: string | null
}

export const PromptSuggestion = Extension.create<object, PromptSuggestionStorage>({
  name: 'promptSuggestion',

  addStorage() {
    return { suggestion: null }
  },

  addProseMirrorPlugins() {
    const storage = this.storage

    return [
      new Plugin({
        key: new PluginKey('promptSuggestion'),
        props: {
          decorations(state) {
            const suggestion = storage.suggestion
            if (!suggestion) return DecorationSet.empty

            const doc = state.doc
            if (doc.textContent.length > 0) return DecorationSet.empty

            let targetPos = -1
            let targetSize = 0
            doc.descendants((node, pos) => {
              if (node.isBlock && node.childCount === 0 && targetPos < 0) {
                targetPos = pos
                targetSize = node.nodeSize
                return false
              }
              return true
            })

            if (targetPos < 0) return DecorationSet.empty

            const deco = Decoration.node(targetPos, targetPos + targetSize, {
              class: 'has-prompt-suggestion',
              'data-prompt-suggestion': suggestion,
            })

            return DecorationSet.create(doc, [deco])
          },
        },
      }),
    ]
  },
})
