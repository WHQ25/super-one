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
            const paragraph = doc.firstChild
            if (!paragraph || paragraph.type.name !== 'paragraph') return DecorationSet.empty

            const firstInline = paragraph.firstChild
            if (!firstInline || !firstInline.isText) return DecorationSet.empty

            const firstText = firstInline.text ?? ''
            if (!firstText.startsWith('/')) return DecorationSet.empty

            const cmdMatch = firstText.match(/^\/\S*/)
            if (!cmdMatch) return DecorationSet.empty

            const cmdPart = cmdMatch[0]
            const cmdName = cmdPart.slice(1)
            const commands = storage.slashCommands
            const exact = commands.find((c) => c.name === cmdName)
            const hasMatch = commands.some((c) =>
              c.name.toLowerCase().startsWith(cmdName.toLowerCase()),
            )
            if (!hasMatch && !exact) return DecorationSet.empty

            const decorations: Decoration[] = []
            const startOffset = 1

            decorations.push(
              Decoration.inline(startOffset, startOffset + cmdPart.length, {
                style: 'color: #60a5fa',
              }),
            )

            if (exact?.argumentHint) {
              const hintTokens = exact.argumentHint.match(/<[^>]+>|\[[^\]]+\]/g) ?? []

              let filledCount = 0
              let lastChildIsMention = false
              let lastTextEndsWithSpace = false

              paragraph.forEach((node, _offset, index) => {
                if (node.isText) {
                  let textPart = node.text ?? ''
                  if (index === 0) textPart = textPart.slice(cmdPart.length)
                  const trimmed = textPart.trim()
                  if (trimmed) filledCount += trimmed.split(/\s+/).length
                  lastChildIsMention = false
                  lastTextEndsWithSpace = textPart.endsWith(' ')
                } else if (node.type.name === 'mention') {
                  filledCount += 1
                  lastChildIsMention = true
                  lastTextEndsWithSpace = false
                }
              })

              const remainingHints = hintTokens.slice(filledCount)

              if (remainingHints.length > 0) {
                const hintPrefix = lastTextEndsWithSpace || lastChildIsMention ? '' : ' '
                const endPos = startOffset + paragraph.content.size
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
