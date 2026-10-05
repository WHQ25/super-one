import { useState, useCallback } from 'react'
import { Copy, Check } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { tryCopy } from '@/lib/clipboard'

export function CopyButton({ copied, onClick, className }: { copied: boolean; onClick: () => void; className?: string }) {
  return (
    <button
      onClick={onClick}
      className={cn('cursor-pointer rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/copy:opacity-100', className ?? 'absolute right-0 top-0')}
    >
      {copied
        ? <Check className="size-3 text-success" />
        : <Copy className="size-3" />
      }
    </button>
  )
}

/** `copied` flips on for a moment after `run`'s copy succeeds. */
export function useCopyFeedback() {
  const [copied, setCopied] = useState(false)
  const run = useCallback(async (copy: () => Promise<boolean>) => {
    if (!(await copy())) return
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [])
  return { copied, run }
}

export function useCopyText() {
  const { copied, run } = useCopyFeedback()
  const copy = useCallback((text: string) => run(() => tryCopy(text)), [run])
  return { copied, copy }
}
