import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { SlashCommandInfo } from '@superone/shared/agent-types'
import { remainingSlashArgumentHint } from './slash-argument-hint'

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
                style: 'color: var(--highlighted)',
              }),
            )

            if (exact?.argumentHint) {
              const filledArgs: string[] = []
              let lastChildIsMention = false
              let lastTextEndsWithSpace = false
              // Multi-line input is a single paragraph split by hardBreak nodes
              // (ChatInput's Shift/Alt+Enter → setHardBreak). Confine the hint to
              // the first visual line: stop at the first break and anchor the
              // widget there, so it never trails to the end of a later line.
              let firstLineEnd = paragraph.content.size
              let reachedBreak = false

              paragraph.forEach((node, offset, index) => {
                if (reachedBreak) return
                if (node.type.name === 'hardBreak') {
                  firstLineEnd = offset
                  reachedBreak = true
                  return
                }
                if (node.isText) {
                  let textPart = node.text ?? ''
                  if (index === 0) textPart = textPart.slice(cmdPart.length)
                  const trimmed = textPart.trim()
                  if (trimmed) filledArgs.push(...trimmed.split(/\s+/).filter(Boolean))
                  lastChildIsMention = false
                  lastTextEndsWithSpace = textPart.endsWith(' ')
                } else if (node.type.name === 'mention') {
                  const label =
                    (typeof node.attrs?.label === 'string' && node.attrs.label)
                    || (typeof node.attrs?.id === 'string' && node.attrs.id)
                    || '@'
                  filledArgs.push(label)
                  lastChildIsMention = true
                  lastTextEndsWithSpace = false
                }
              })

              // Trailing space means the last arg is "committed" for matching;
              // without it, a mid-word partial still counts as the last filled arg
              // (same as the previous filledCount behavior via split).
              const remaining = remainingSlashArgumentHint(exact.argumentHint, filledArgs)

              if (remaining) {
                const hintPrefix = lastTextEndsWithSpace || lastChildIsMention ? '' : ' '
                const endPos = startOffset + firstLineEnd
                decorations.push(
                  Decoration.widget(endPos, () => {
                    const span = document.createElement('span')
                    span.style.cssText = 'color: var(--muted-foreground); pointer-events: none;'
                    span.textContent = hintPrefix + remaining
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
