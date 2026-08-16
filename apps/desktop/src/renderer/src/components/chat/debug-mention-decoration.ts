/**
 * Ghost after a @debug chip — same visual language as SlashDecoration /
 * SessionMentionDecoration. Not Tab-insertable; it is a prompt, not a draft.
 */

import { Extension, type Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import {
  debugMentionGhostPrefix,
  type DebugGhostPiece,
} from './debug-mention-ghost'

export interface DebugMentionDecorationOptions {
  hint: string
}

export interface DebugMentionDecorationStorage {
  hint: string
}

function firstLineGhost(paragraph: PMNode): {
  pieces: DebugGhostPiece[]
  widgetOffset: number
} {
  const pieces: DebugGhostPiece[] = []
  let widgetOffset = 0
  let reachedBreak = false

  paragraph.forEach((node, offset) => {
    if (reachedBreak) return
    if (node.type.name === 'hardBreak') {
      pieces.push({ type: 'hardBreak' })
      widgetOffset = offset
      reachedBreak = true
      return
    }
    widgetOffset = offset + node.nodeSize
    if (node.type.name === 'mention') {
      pieces.push({ type: 'mention', kind: typeof node.attrs.kind === 'string' ? node.attrs.kind : '' })
      return
    }
    if (node.isText) {
      pieces.push({ type: 'text', text: node.text ?? '' })
      return
    }
    pieces.push({ type: 'other' })
  })

  return { pieces, widgetOffset }
}

export const DebugMentionDecoration = Extension.create<
  DebugMentionDecorationOptions,
  DebugMentionDecorationStorage
>({
  name: 'debugMentionDecoration',

  addOptions() {
    return { hint: '' }
  },

  addStorage() {
    return { hint: this.options.hint }
  },

  addProseMirrorPlugins() {
    const storage = this.storage

    return [
      new Plugin({
        key: new PluginKey('debugMentionDecoration'),
        props: {
          decorations(state) {
            const hint = storage.hint
            if (!hint) return DecorationSet.empty

            const paragraph = state.doc.firstChild
            if (!paragraph || paragraph.type.name !== 'paragraph') return DecorationSet.empty

            const { pieces, widgetOffset } = firstLineGhost(paragraph)
            const prefix = debugMentionGhostPrefix(pieces)
            if (prefix === null) return DecorationSet.empty

            return DecorationSet.create(state.doc, [
              Decoration.widget(1 + widgetOffset, () => {
                const span = document.createElement('span')
                span.style.cssText =
                  'color: var(--muted-foreground); pointer-events: none; user-select: none;'
                span.setAttribute('data-debug-bug-hint', 'true')
                span.textContent = prefix + hint
                return span
              }, { side: 1 }),
            ])
          },
        },
      }),
    ]
  },
})

export function syncDebugMentionHint(
  editor: Editor | null | undefined,
  hint: string,
): void {
  if (!editor || editor.isDestroyed) return
  const storage = editor.storage.debugMentionDecoration as DebugMentionDecorationStorage | undefined
  if (!storage) return
  storage.hint = hint
  editor.view.dispatch(editor.state.tr)
}
