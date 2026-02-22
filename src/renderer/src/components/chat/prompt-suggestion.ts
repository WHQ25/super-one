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
          attributes(state): Record<string, string> {
            if (storage.suggestion && state.doc.textContent.length === 0) {
              return { class: 'has-prompt-suggestion' }
            }
            return {}
          },
          decorations(state) {
            const suggestion = storage.suggestion
            if (!suggestion) return DecorationSet.empty

            const doc = state.doc
            if (doc.textContent.length > 0) return DecorationSet.empty

            let insertPos = 1
            doc.descendants((node, pos) => {
              if (node.isBlock && node.childCount === 0) {
                insertPos = pos + 1
                return false
              }
              return true
            })

            const widget = Decoration.widget(
              insertPos,
              () => {
                const container = document.createElement('span')
                container.className = 'prompt-suggestion-ghost'

                const text = document.createElement('span')
                text.textContent = suggestion
                container.appendChild(text)

                const badge = document.createElement('kbd')
                badge.className = 'prompt-suggestion-badge'
                badge.textContent = 'Tab'
                container.appendChild(badge)

                return container
              },
              { side: -1 },
            )

            return DecorationSet.create(doc, [widget])
          },
        },
      }),
    ]
  },
})
