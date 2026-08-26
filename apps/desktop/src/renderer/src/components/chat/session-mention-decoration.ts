/**
 * Ghost argument-hint for @session mentions (same visual language as SlashDecoration).
 *
 * Grammar: @session <project | all> <title>
 * - pick-project → `<project | all> <title>`
 * - need-title   → `<title>`
 * - search       → hide (user typing freeform title)
 *
 * When the user dismisses the mention popup with Escape, ChatInput marks that
 * @ position as dismissed — decorations must hide too so the token reads as
 * plain text (no highlight, no ghost grammar).
 */

import { Extension, type Editor } from '@tiptap/core'
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
  /** Doc positions of `@` tokens the user dismissed (Escape / onClose). */
  dismissedAtPositions: Set<number>
}

// Tiptap ships `interface Storage {}` empty for extensions to augment; without
// this `editor.storage.sessionMentionDecoration` is not a known property.
declare module '@tiptap/core' {
  interface Storage {
    sessionMentionDecoration: SessionMentionDecorationStorage
  }
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
    return {
      projects: this.options.projects,
      dismissedAtPositions: new Set<number>(),
    }
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
            if (storage.dismissedAtPositions.has(atPos)) {
              return DecorationSet.empty
            }

            const sessionWord =
              afterAt.match(new RegExp(`^${SESSION_MENTION_KEYWORD}\\b`, 'i'))?.[0]
              ?? SESSION_MENTION_KEYWORD
            const sessionTokenEnd = atPos + 1 + sessionWord.length

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

/** Push ChatInput's Escape-dismiss set into decoration storage and redraw. */
export function syncSessionMentionDismissed(
  editor: Editor | null | undefined,
  dismissedAt: Iterable<number>,
): void {
  if (!editor || editor.isDestroyed) return
  const storage = editor.storage.sessionMentionDecoration as SessionMentionDecorationStorage | undefined
  if (!storage) return
  storage.dismissedAtPositions = new Set(dismissedAt)
  // Escape does not change the doc — force decoration recompute.
  editor.view.dispatch(editor.state.tr)
}
