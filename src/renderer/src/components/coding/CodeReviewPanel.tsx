import { FileCode } from 'lucide-react'

export function CodeReviewPanel() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <FileCode className="size-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">Code Review</span>
      </div>
      <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
        Code review panel — coming soon
      </div>
    </div>
  )
}
