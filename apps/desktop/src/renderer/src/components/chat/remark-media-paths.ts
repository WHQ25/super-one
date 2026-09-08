import type { Root, Image, Definition } from 'mdast'
import { visit } from 'unist-util-visit'
import { resolveMarkdownMediaSrc } from './chat-shared'

/** Resolve parsed destinations, never Markdown source (which may be code). */
export function remarkMediaPaths(projectPath: string) {
  return () => (tree: Root) => {
    const imageReferences = new Set<string>()
    visit(tree, 'imageReference', (node) => { imageReferences.add(node.identifier) })
    visit(tree, (node) => {
      if (node.type !== 'image' && !(node.type === 'definition' && imageReferences.has(node.identifier))) return
      const media = node as Image | Definition
      let src = media.url
      // Markdown destinations are URLs. Decode once before the filesystem-to-URL
      // conversion, but preserve already qualified transports verbatim.
      if (!/^[a-z][a-z\d+.-]*:\/\//i.test(src) && !/^(?:data:|blob:)/i.test(src)) {
        try { src = decodeURIComponent(src) } catch { /* literal percent in a file name */ }
      }
      media.url = resolveMarkdownMediaSrc(src, projectPath)
    })
  }
}
