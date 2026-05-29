import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@superone/ui/components/ui/dialog'
import { Button } from '@superone/ui/components/ui/button'
import type { MathEditTarget } from './math'

interface MathEditDialogProps {
  editor: Editor | null
  target: MathEditTarget | null
  onClose: () => void
}

export function MathEditDialog({ editor, target, onClose }: MathEditDialogProps) {
  const [latex, setLatex] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (target) setLatex(target.latex)
  }, [target])

  useEffect(() => {
    if (target && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.select()
    }
  }, [target])

  const commit = () => {
    if (!editor || !target) return
    const next = latex.trim()
    const chain = editor.chain().focus().setNodeSelection(target.pos)
    if (!next) {
      if (target.kind === 'inline') chain.deleteInlineMath().run()
      else chain.deleteBlockMath().run()
    } else if (target.kind === 'inline') {
      chain.updateInlineMath({ latex: next }).run()
    } else {
      chain.updateBlockMath({ latex: next }).run()
    }
    onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      commit()
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogTitle>{target?.kind === 'block' ? 'Edit block math' : 'Edit inline math'}</DialogTitle>
        <DialogDescription className="sr-only">Edit the LaTeX expression</DialogDescription>
        <textarea
          ref={textareaRef}
          value={latex}
          onChange={(e) => setLatex(e.target.value)}
          onKeyDown={onKeyDown}
          rows={target?.kind === 'block' ? 4 : 2}
          spellCheck={false}
          className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
          placeholder="LaTeX"
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={commit}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
