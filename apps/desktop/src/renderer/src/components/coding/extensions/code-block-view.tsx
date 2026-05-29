import { useCallback, useState } from 'react'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { ReactNodeViewRenderer, NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/core'
import { Check, Copy } from 'lucide-react'
import { tryCopy } from '@/lib/clipboard'

function CodeBlockView({ node }: NodeViewProps) {
  const [copied, setCopied] = useState(false)
  const language = (node.attrs.language as string) || 'text'

  const handleCopy = useCallback(async () => {
    if (!(await tryCopy(node.textContent))) return
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [node])

  return (
    <NodeViewWrapper className="code-block-node">
      <div className="code-block-header" contentEditable={false}>
        <span className="code-block-lang">{language}</span>
        <button type="button" onClick={handleCopy} className="code-block-copy" title="Copy">
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      </div>
      <pre>
        <NodeViewContent as={'code' as 'div'} />
      </pre>
    </NodeViewWrapper>
  )
}

export const CodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView)
  },
})
