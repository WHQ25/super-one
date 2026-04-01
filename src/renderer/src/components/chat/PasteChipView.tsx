import { useState } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { FileText, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PasteChipPreview } from './PasteChipPreview'

export function PasteChipView({ node, getPos, editor, selected }: NodeViewProps) {
  const { text, lineCount, preview } = node.attrs as { text: string; lineCount: number; preview: string }
  const [previewOpen, setPreviewOpen] = useState(false)

  const handleRemove = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const pos = getPos()
    if (pos != null) {
      editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run()
    }
  }

  return (
    <NodeViewWrapper
      as="div"
      contentEditable={false}
      data-paste-chip=""
      className={cn(
        'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm text-foreground select-none transition-colors',
        selected
          ? 'border-primary/50 bg-primary/10 ring-1 ring-primary/30'
          : 'border-border bg-muted/50 hover:bg-muted'
      )}
    >
      <div
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2"
        onClick={() => setPreviewOpen(true)}
      >
        <FileText className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate text-muted-foreground">{preview}</span>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">{lineCount} lines</span>
      </div>
      <button
        onMouseDown={handleRemove}
        className="shrink-0 text-muted-foreground hover:text-foreground"
        contentEditable={false}
      >
        <X className="size-3.5" />
      </button>
      <PasteChipPreview open={previewOpen} onOpenChange={setPreviewOpen} text={text} lineCount={lineCount} />
    </NodeViewWrapper>
  )
}
