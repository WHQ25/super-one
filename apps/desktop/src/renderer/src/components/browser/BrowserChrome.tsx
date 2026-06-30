import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, RotateCw, ExternalLink, Camera, SquareDashedMousePointer, MoreHorizontal } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { useBrowserStore } from '@/stores/browser'

interface BrowserChromeProps {
  browserId: string
  onNavigate: (input: string) => void
  onBack: () => void
  onForward: () => void
  onReload: () => void
  onStop: () => void
}

export function BrowserChrome({ browserId, onNavigate, onBack, onForward, onReload, onStop }: BrowserChromeProps) {
  const state = useBrowserStore((s) => s.tabs[browserId])
  const url = state?.url ?? ''
  const loading = state?.loading ?? false
  const [draft, setDraft] = useState(url)
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) setDraft(url)
  }, [url, editing])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    inputRef.current?.blur()
    onNavigate(draft)
  }

  return (
    <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-border bg-transparent px-2">
      <IconButton size="xs" variant="ghost" tooltip="Back" disabled={!state?.canGoBack} onClick={onBack}>
        <ArrowLeft className="size-3.5" />
      </IconButton>
      <IconButton size="xs" variant="ghost" tooltip="Forward" disabled={!state?.canGoForward} onClick={onForward}>
        <ArrowRight className="size-3.5" />
      </IconButton>
      <IconButton
        size="xs"
        variant="ghost"
        tooltip={loading ? 'Stop' : 'Reload'}
        onClick={loading ? onStop : onReload}
      >
        <RotateCw className={cn('size-3.5', loading && 'animate-spin')} />
      </IconButton>
      <form onSubmit={submit} className="group relative mx-1 min-w-0 flex-1">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => { setEditing(true); e.target.select() }}
          onBlur={() => setEditing(false)}
          spellCheck={false}
          placeholder="Search or enter address"
          className="h-6 w-full rounded-md bg-transparent px-1.5 text-xs text-foreground outline-none transition-all hover:bg-muted group-hover:pr-7 focus:bg-muted focus:ring-1 focus:ring-ring"
        />
        {url && (
          <IconButton
            type="button"
            size="xs"
            variant="ghost"
            tooltip="Open in external browser"
            onClick={() => window.app.openExternalLink(url)}
            className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          >
            <ExternalLink className="size-3.5" />
          </IconButton>
        )}
      </form>
      <IconButton size="xs" variant="ghost" tooltip="Screenshot">
        <Camera className="size-3.5" />
      </IconButton>
      <IconButton size="xs" variant="ghost" tooltip="Mark element">
        <SquareDashedMousePointer className="size-3.5" />
      </IconButton>
      <IconButton size="xs" variant="ghost" tooltip="More">
        <MoreHorizontal className="size-3.5" />
      </IconButton>
    </div>
  )
}
