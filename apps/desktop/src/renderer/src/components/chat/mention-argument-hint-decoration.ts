/**
 * Ghost argument-hint for portal mentions (`@session …`, `@git …`) — the same
 * visual language as SlashDecoration: keyword highlighted, remaining grammar
 * shown as muted ghost text after the caret.
 *
 * When the user dismisses the mention popup with Escape, ChatInput marks that
 * @ position as dismissed — decorations must hide too so the token reads as
 * plain text (no highlight, no ghost grammar). Every portal decoration shares
 * one dismissed set via `syncPortalMentionDismissed`.
 */

import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export interface MentionArgumentHintStorage<Ctx> {
  /** Extra data the grammar needs to decide what is left to type. */
  context: Ctx
  /** Doc positions of `@` tokens the user dismissed (Escape / onClose). */
  dismissedAtPositions: Set<number>
}

export interface MentionArgumentHintSpec<Ctx> {
  /** Extension + storage name, e.g. `sessionMentionDecoration`. */
  name: string
  /** Default keyword; the ghost attribute and highlight fall back to it. */
  keyword: string
  /** The keyword this particular query opened with, for grammars with several (`git` / `gh`). */
  keywordOf?: (afterAt: string, context: Ctx) => string | null
  isQuery: (afterAt: string, context: Ctx) => boolean
  remainingHint: (afterAt: string, context: Ctx) => string | null
}

const PORTAL_DECORATION_NAMES: string[] = []

export function createMentionArgumentHintExtension<Ctx>(spec: MentionArgumentHintSpec<Ctx>) {
  PORTAL_DECORATION_NAMES.push(spec.name)
  return Extension.create<{ context: Ctx }, MentionArgumentHintStorage<Ctx>>({
    name: spec.name,

    addOptions() {
      return { context: undefined as unknown as Ctx }
    },

    addStorage() {
      return {
        context: this.options.context,
        dismissedAtPositions: new Set<number>(),
      }
    },

    addProseMirrorPlugins() {
      const storage = this.storage

      return [
        new Plugin({
          key: new PluginKey(spec.name),
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
              if (!spec.isQuery(afterAt, storage.context)) return DecorationSet.empty

              const blockStart = $pos.start()
              const atPos = blockStart + lastAt
              if (storage.dismissedAtPositions.has(atPos)) {
                return DecorationSet.empty
              }

              const keyword = spec.keywordOf?.(afterAt, storage.context) ?? spec.keyword
              const keywordWord =
                afterAt.match(new RegExp(`^${keyword}\\b`, 'i'))?.[0] ?? keyword
              const keywordEnd = atPos + 1 + keywordWord.length

              const decorations: Decoration[] = [
                Decoration.inline(atPos, Math.min(keywordEnd, from), {
                  style: 'color: var(--highlighted)',
                }),
              ]

              const remaining = spec.remainingHint(afterAt, storage.context)
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
                      span.setAttribute('data-mention-arg-hint', spec.keyword)
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
}

/** Push ChatInput's Escape-dismiss set into every portal decoration and redraw. */
export function syncPortalMentionDismissed(
  editor: Editor | null | undefined,
  dismissedAt: Iterable<number>,
): void {
  if (!editor || editor.isDestroyed) return
  const next = new Set(dismissedAt)
  let touched = false
  for (const name of PORTAL_DECORATION_NAMES) {
    const storage = (editor.storage as unknown as Record<string, unknown>)[name] as
      | MentionArgumentHintStorage<unknown>
      | undefined
    if (!storage) continue
    storage.dismissedAtPositions = new Set(next)
    touched = true
  }
  // Escape does not change the doc — force decoration recompute.
  if (touched) editor.view.dispatch(editor.state.tr)
}
