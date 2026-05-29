import { nodePasteRule, type Extension, type Node } from '@tiptap/core'
import { InlineMath, BlockMath } from '@tiptap/extension-mathematics'
import 'katex/dist/katex.min.css'

export interface MathEditTarget {
  pos: number
  latex: string
  kind: 'inline' | 'block'
}

interface MathFactoryOptions {
  onEdit: (target: MathEditTarget) => void
}

const KATEX_OPTIONS = { throwOnError: false, strict: false } as const

export function createMathExtensions({ onEdit }: MathFactoryOptions): (Extension | Node)[] {
  const inline = InlineMath.extend({
    addPasteRules() {
      return [
        nodePasteRule({
          find: /(?<![\\$])\$([^$\n]+?)\$(?!\$)/g,
          type: this.type,
          getAttributes: (match) => ({ latex: match[1] }),
        }),
      ]
    },
  }).configure({
    katexOptions: KATEX_OPTIONS,
    onClick: (node, pos) => onEdit({ pos, latex: (node.attrs.latex as string) || '', kind: 'inline' }),
  })

  const block = BlockMath.extend({
    addPasteRules() {
      return [
        nodePasteRule({
          find: /\$\$\n([\s\S]+?)\n\$\$/g,
          type: this.type,
          getAttributes: (match) => ({ latex: match[1] }),
        }),
      ]
    },
  }).configure({
    katexOptions: KATEX_OPTIONS,
    onClick: (node, pos) => onEdit({ pos, latex: (node.attrs.latex as string) || '', kind: 'block' }),
  })

  return [inline, block]
}
