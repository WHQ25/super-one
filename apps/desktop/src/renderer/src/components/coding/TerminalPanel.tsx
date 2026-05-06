import { Terminal } from 'lucide-react'

export function TerminalPanel() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <Terminal className="size-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">Terminal</span>
      </div>
      <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
        Terminal panel — coming soon
      </div>
    </div>
  )
}
