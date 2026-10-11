/**
 * Draws every bare web link in the draft the way chat draws a markdown link
 * (`.web-link` colour, the site's favicon in front). The text stays plain:
 * nothing about the draft or what is sent changes. Clicking places the caret;
 * the link opens from its hover preview (`ComposerLinkPreview`).
 */

import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { createRoot, type Root } from 'react-dom/client'
import { findWebLinks } from '@superone/shared/web-links'
import { draftText } from './composer-draft-text'
import { LinkFavicon } from './link-preview/WebLink'

/** The attribute naming a drawn link's URL, on its text and its favicon. */
export const WEB_LINK_ATTR = 'data-web-link'

const key = new PluginKey<DecorationSet>('webLinkDecoration')
const faviconRoots = new WeakMap<Node, Root>()

function favicon(href: string): HTMLElement {
  const dom = document.createElement('span')
  dom.className = 'composer-web-link-icon'
  dom.contentEditable = 'false'
  dom.setAttribute(WEB_LINK_ATTR, href)
  const root = createRoot(dom)
  // Deferred: TipTap may build the view (and this widget) while React is rendering.
  queueMicrotask(() => root.render(<LinkFavicon href={href} />))
  faviconRoots.set(dom, root)
  return dom
}

function linkDecorations(doc: PMNode): DecorationSet {
  const { text, positions } = draftText(doc)
  const decorations: Decoration[] = []
  findWebLinks(text).forEach((link, index) => {
    // A link never spans a newline or a chip, so its characters sit at consecutive positions.
    const from = positions[link.start]!
    const to = positions[link.end - 1]! + 1
    decorations.push(
      // Keyed by order and URL: typing elsewhere keeps the icon's DOM rather than flashing it.
      Decoration.widget(from, () => favicon(link.href), {
        side: 1,
        key: `web-link:${index}:${link.href}`,
        // Deferred: ProseMirror may drop the widget while React is rendering.
        destroy: (dom) => { const root = faviconRoots.get(dom); if (root) queueMicrotask(() => root.unmount()) },
      }),
      Decoration.inline(from, to, { class: 'web-link', [WEB_LINK_ATTR]: link.href, spellcheck: 'false' }),
    )
  })
  return DecorationSet.create(doc, decorations)
}

export const WebLinkDecoration = Extension.create({
  name: 'webLinkDecoration',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        state: {
          init: (_, state) => linkDecorations(state.doc),
          apply: (tr, previous) => (tr.docChanged ? linkDecorations(tr.doc) : previous),
        },
        props: {
          decorations: (state) => key.getState(state),
        },
      }),
    ]
  },
})
