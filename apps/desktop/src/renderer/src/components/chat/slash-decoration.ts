import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { SlashCommandInfo } from '@superone/shared/agent-types'

export interface SlashDecorationOptions {
  slashCommands: SlashCommandInfo[]
}

export interface SlashDecorationStorage {
  slashCommands: SlashCommandInfo[]
}

export const SlashDecoration = Extension.create<SlashDecorationOptions, SlashDecorationStorage>({
  name: 'slashDecoration',

  addOptions() {
    return { slashCommands: [] }
  },

  addStorage() {
    return { slashCommands: this.options.slashCommands }
  },

  addProseMirrorPlugins() {
    const storage = this.storage

    return [
      new Plugin({
        key: new PluginKey('slashDecoration'),
        props: {
          decorations(state) {
            const doc = state.doc
            const text = doc.textContent
            if (!text.startsWith('/')) return DecorationSet.empty

            const match = text.match(/^(\/\S*)(.*)$/s)
            if (!match) return DecorationSet.empty

            const cmdPart = match[1]
            const rest = match[2]
            const cmdName = cmdPart.slice(1)
            const commands = storage.slashCommands
            const exact = commands.find((c) => c.name === cmdName)
            const hasMatch = commands.some((c) =>
              c.name.toLowerCase().startsWith(cmdName.toLowerCase()),
            )
            if (!hasMatch && !exact) return DecorationSet.empty

            const decorations: Decoration[] = []

            // Find the text node position — walk through the first paragraph
            let startOffset = 0
            doc.descendants((node, pos) => {
              if (node.isText && startOffset === 0) {
                startOffset = pos
                return false
              }
              return true
            })

            // Blue highlight on /command
            decorations.push(
              Decoration.inline(startOffset, startOffset + cmdPart.length, {
                style: 'color: #60a5fa',
              }),
            )

            // Argument hint widget after existing text
            if (exact?.argumentHint) {
              const hintTokens = exact.argumentHint.match(/<[^>]+>|\[[^\]]+\]/g) ?? []
              const trimmedRest = rest.trimStart()
              const filledCount = trimmedRest ? trimmedRest.split(/\s+/).length : 0
              const remainingHints = hintTokens.slice(filledCount)

              if (remainingHints.length > 0) {
                const hintPrefix = rest.endsWith(' ') ? '' : ' '
                const endPos = startOffset + text.length
                decorations.push(
                  Decoration.widget(endPos, () => {
                    const span = document.createElement('span')
                    span.style.cssText = 'color: var(--muted-foreground); pointer-events: none;'
                    span.textContent = hintPrefix + remainingHints.join(' ')
                    return span
                  }),
                )
              }
            }

            return DecorationSet.create(doc, decorations)
          },
        },
      }),
    ]
  },
})
