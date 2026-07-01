import type { RefObject } from 'react'
import { ArrowUp, ArrowDown, X } from 'lucide-react'

interface Props {
  value: string
  onChange: (value: string) => void
  hits: { idx: number; count: number }
  onNext: () => void
  onPrev: () => void
  onClose: () => void
  inputRef: RefObject<HTMLInputElement | null>
}

export function TerminalFindBar({ value, onChange, hits, onNext, onPrev, onClose, inputRef }: Props) {
  return (
    <div className="absolute right-3 top-2 z-20 flex items-center gap-1 rounded-lg border border-border bg-popover px-1.5 py-1 shadow-md">
      <input
        ref={inputRef}
        autoFocus
        value={value}
        placeholder="Find"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (e.shiftKey) onPrev()
            else onNext()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
        className="w-44 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
      />
      <span className="min-w-10 text-right text-[11px] tabular-nums text-muted-foreground">
        {hits.count ? `${hits.idx + 1}/${hits.count}` : '0/0'}
      </span>
      <button
        onClick={onPrev}
        disabled={!hits.count}
        className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-40"
        title="Previous (⇧↵)"
      >
        <ArrowUp className="size-3.5" />
      </button>
      <button
        onClick={onNext}
        disabled={!hits.count}
        className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-40"
        title="Next (↵)"
      >
        <ArrowDown className="size-3.5" />
      </button>
      <button
        onClick={onClose}
        className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        title="Close (Esc)"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}
