/**
 * Ghost argument-hint for @chat mentions (same visual language as SlashDecoration).
 *
 * Grammar: @chat <project | all> <title>
 * - pick-project → `<project | all> <title>`
 * - need-title   → `<title>`
 * - search       → hide (user typing freeform title)
 */

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import {
  isSessionMentionQuery,
  remainingSessionArgumentHint,
  SESSION_MENTION_KEYWORD,
  type ProjectOption,
} from './session-mention-query'

export interface SessionMentionDecorationOptions {
  projects: ProjectOption[]
}

export interface SessionMentionDecorationStorage {
  projects: ProjectOption[]
}

export const SessionMentionDecoration = Extension.create<
  SessionMentionDecorationOptions,
  SessionMentionDecorationStorage
>({
  name: 'sessionMentionDecoration',

  addOptions() {
    return { projects: [] }
  },

  addStorage() {
    return { projects: this.options.projects }
  },

  addProseMirrorPlugins() {
    const storage = this.storage

    return [
      new Plugin({
        key: new PluginKey('sessionMentionDecoration'),
        props: {
          decorations(state) {
            const { from } = state.selection
            const $pos = state.doc.resolve(from)
            if (!$pos.parent.isTextblock) return DecorationSet.empty

            const textBefore = $pos.parent.textBetween(0, $pos.parentOffset, undefined, '\0')
            if (textBefore.includes('\0')) return DecorationSet.empty

            const lastAt = textBefore.lastIndexOf('@')
            if (lastAt < 0) return DecorationSet.empty

            const afterAt = textBefore.slice(lastAt + 1)
            if (!isSessionMentionQuery(afterAt)) return DecorationSet.empty

            const blockStart = $pos.start()
            const atPos = blockStart + lastAt
            const chatWord =
              afterAt.match(new RegExp(`^${SESSION_MENTION_KEYWORD}\\b`, 'i'))?.[0]
              ?? SESSION_MENTION_KEYWORD
            const sessionTokenEnd = atPos + 1 + chatWord.length

            const decorations: Decoration[] = [
              Decoration.inline(atPos, Math.min(sessionTokenEnd, from), {
                style: 'color: var(--highlighted)',
              }),
            ]

            const remaining = remainingSessionArgumentHint(afterAt, storage.projects)
            if (remaining) {
              // Match SlashDecoration: add a leading space only when the query
              // does not already end with whitespace.
              const prefix = /\s$/.test(afterAt) ? '' : ' '
              decorations.push(
                Decoration.widget(
                  from,
                  () => {
                    const span = document.createElement('span')
                    span.style.cssText =
                      'color: var(--muted-foreground); pointer-events: none; user-select: none;'
                    span.setAttribute('data-session-arg-hint', 'true')
                    span.textContent = prefix + remaining
                    return span
                  },
                  { side: 1 },
                ),
              )
            }

            return DecorationSet.create(state.doc, decorations)
          },
        },
      }),
    ]
  },
})
