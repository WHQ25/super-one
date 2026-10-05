import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

interface ChipSelectionState {
  /** Whether the document's selection is currently inside this editor. */
  inside: boolean
  /** Rendered height (px) of an inline box in the editor font. */
  textHeight: number | null
}

const chipSelectionKey = new PluginKey<ChipSelectionState>('chipSelection')

/**
 * An inline box's background covers only the font's ascent + descent, which
 * varies by font, while the native highlight fills the line. Measure it in the
 * editor's own font so CSS can pad chip wrappers to the full line height.
 */
function measureInlineTextHeight(dom: HTMLElement): number {
  const doc = dom.ownerDocument
  const host = doc.createElement('div')
  host.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none'
  const probe = doc.createElement('span')
  const { fontFamily, fontSize, fontStyle, fontWeight } = getComputedStyle(dom)
  Object.assign(probe.style, { fontFamily, fontSize, fontStyle, fontWeight })
  probe.textContent = 'x'
  host.append(probe)
  doc.body.append(host)
  const height = probe.getBoundingClientRect().height
  host.remove()
  return height
}

/**
 * Composer chips are `contenteditable=false` + `user-select: none` atoms, so the
 * browser's selection highlight skips them even though copy includes them. Mark
 * every atom the selection covers with `.chip-in-selection` (styled in
 * index.css). Only while the DOM selection is in the editor: once the native
 * highlight moves elsewhere, a lone lit chip would be a stale selection.
 */
export const ChipSelection = Extension.create({
  name: 'chipSelection',

  addProseMirrorPlugins() {
    return [
      new Plugin<ChipSelectionState>({
        key: chipSelectionKey,
        state: {
          init: () => ({ inside: false, textHeight: null }),
          apply: (tr, value) => {
            const patch = tr.getMeta(chipSelectionKey) as Partial<ChipSelectionState> | undefined
            return patch ? { ...value, ...patch } : value
          },
        },
        view(view) {
          const doc = view.dom.ownerDocument
          void doc.fonts.ready.then(() => {
            if (view.isDestroyed) return
            view.dispatch(view.state.tr.setMeta(chipSelectionKey, { textHeight: measureInlineTextHeight(view.dom) }))
          })
          const sync = (): void => {
            const anchor = doc.getSelection()?.anchorNode
            const inside = !!anchor && view.dom.contains(anchor)
            if (inside !== chipSelectionKey.getState(view.state)?.inside) {
              view.dispatch(view.state.tr.setMeta(chipSelectionKey, { inside }))
            }
          }
          doc.addEventListener('selectionchange', sync)
          return { destroy: () => doc.removeEventListener('selectionchange', sync) }
        },
        props: {
          attributes(state): Record<string, string> {
            const textHeight = chipSelectionKey.getState(state)?.textHeight
            return textHeight ? { style: `--chip-text-height: ${textHeight}px` } : {}
          },
          decorations(state) {
            const { from, to, empty } = state.selection
            if (empty || !chipSelectionKey.getState(state)?.inside) return null
            const decorations: Decoration[] = []
            state.doc.nodesBetween(from, to, (node, pos) => {
              if (node.type.spec.atom && pos >= from && pos + node.nodeSize <= to) {
                decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'chip-in-selection' }))
              }
            })
            return DecorationSet.create(state.doc, decorations)
          },
        },
      }),
    ]
  },
})
