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

export function useCopyText() {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(async (text: string) => {
    if (window.getSelection()?.toString()) return
    if (!(await tryCopy(text))) return
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [])
  return { copied, copy }
}
