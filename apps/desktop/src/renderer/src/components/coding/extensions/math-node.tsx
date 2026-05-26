import { Node, mergeAttributes, nodePasteRule } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/core'
import { useEffect, useRef, useState } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    math: {
      insertInlineMath: (latex: string) => ReturnType
      insertDisplayMath: (latex: string) => ReturnType
    }
  }
}

function renderKatex(latex: string, displayMode: boolean): { html: string; error: string | null } {
  try {
    const html = katex.renderToString(latex, { displayMode, throwOnError: true, strict: false })
    return { html, error: null }
  } catch (err) {
    return { html: '', error: err instanceof Error ? err.message : 'KaTeX error' }
  }
}

function MathView({ node, updateAttributes, selected, deleteNode, extension }: NodeViewProps) {
  const displayMode = extension.name === 'displayMath'
  const latex = (node.attrs.latex as string) || ''
  const [isEditing, setIsEditing] = useState(latex.trim() === '')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const rendered = renderKatex(latex, displayMode)

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.select()
    }
  }, [isEditing])

  const commit = () => {
    if (!latex.trim()) {
      deleteNode()
      return
    }
    setIsEditing(false)
  }

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); commit() }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit() }
    e.stopPropagation()
  }

  if (isEditing) {
    return (
      <NodeViewWrapper as={displayMode ? 'div' : 'span'} className={`math-node math-${displayMode ? 'display' : 'inline'} editing`}>
        <textarea
          ref={textareaRef}
          className="math-editor"
          value={latex}
          onChange={(e) => updateAttributes({ latex: e.target.value })}
          onBlur={commit}
          onKeyDown={onKey}
          placeholder={displayMode ? 'LaTeX (block)' : 'LaTeX'}
          rows={displayMode ? 2 : 1}
          spellCheck={false}
        />
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper as={displayMode ? 'div' : 'span'} className={`math-node math-${displayMode ? 'display' : 'inline'} ${selected ? 'selected' : ''}`}>
      <span
        contentEditable={false}
        onDoubleClick={() => setIsEditing(true)}
        className={rendered.error ? 'math-error' : 'math-rendered'}
        dangerouslySetInnerHTML={rendered.error ? undefined : { __html: rendered.html }}
      >
        {rendered.error ? rendered.error : null}
      </span>
    </NodeViewWrapper>
  )
}

export const InlineMath = Node.create({
  name: 'inlineMath',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-latex') ?? el.textContent ?? '',
        renderHTML: (attrs: { latex: string }) => ({ 'data-latex': attrs.latex }),
      },
    }
  },
  parseHTML() {
    return [
      { tag: 'span[data-math-inline]' },
      { tag: 'span[data-type="inline-math"]' },
    ]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'inline-math', 'data-math-inline': '' })]
  },
  addNodeView() { return ReactNodeViewRenderer(MathView) },
  addCommands() {
    return {
      insertInlineMath: (latex: string) => ({ commands }) =>
        commands.insertContent({ type: this.name, attrs: { latex } }),
      insertDisplayMath: () => () => false,
    }
  },
  addPasteRules() {
    return [
      nodePasteRule({
        find: /(?<![\\$])\$([^$\n]+?)\$(?!\$)/g,
        type: this.type,
        getAttributes: (match) => ({ latex: match[1] }),
      }),
    ]
  },
})

export const DisplayMath = Node.create({
  name: 'displayMath',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-latex') ?? el.textContent ?? '',
        renderHTML: (attrs: { latex: string }) => ({ 'data-latex': attrs.latex }),
      },
    }
  },
  parseHTML() {
    return [
      { tag: 'div[data-math-display]' },
      { tag: 'div[data-type="display-math"]' },
    ]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'display-math', 'data-math-display': '' })]
  },
  addNodeView() { return ReactNodeViewRenderer(MathView) },
  addCommands() {
    return {
      insertInlineMath: () => () => false,
      insertDisplayMath: (latex: string) => ({ commands }) =>
        commands.insertContent({ type: this.name, attrs: { latex } }),
    }
  },
  addPasteRules() {
    return [
      nodePasteRule({
        find: /\$\$\n([\s\S]+?)\n\$\$/g,
        type: this.type,
        getAttributes: (match) => ({ latex: match[1] }),
      }),
    ]
  },
})
