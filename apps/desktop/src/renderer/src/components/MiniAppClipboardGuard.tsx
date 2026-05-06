import { useState, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { ClipboardPaste, X } from 'lucide-react'
import { toast } from 'sonner'
import { useMiniAppStore } from '@/stores/miniapp'
import { setClipboardReadHandler, setClipboardWriteHandler } from '@/lib/miniapp-clipboard'

interface PendingRead {
  appId: string
  resolve: (text: string | null) => void
}

function getAppName(appId: string): string {
  return useMiniAppStore.getState().apps.find((a) => a.id === appId)?.manifest.name ?? appId
}

export function MiniAppClipboardGuard() {
  const [pending, setPending] = useState<PendingRead | null>(null)

  useEffect(() => {
    const cleanupRead = setClipboardReadHandler(async (appId) => {
      return new Promise<string | null>((resolve) => {
        setPending({ appId, resolve })
      })
    })
    const cleanupWrite = setClipboardWriteHandler((appId, text) => {
      window.app.clipboardWrite(text)
      toast.success(`Mini app "${getAppName(appId)}" copied to clipboard`)
    })
    return () => { cleanupRead(); cleanupWrite() }
  }, [])

  const handleAllow = useCallback(async () => {
    if (!pending) return
    const text = await window.app.clipboardRead()
    pending.resolve(text)
    setPending(null)
  }, [pending])

  const handleDeny = useCallback(() => {
    if (!pending) return
    pending.resolve(null)
    setPending(null)
  }, [pending])

  useEffect(() => {
    if (!pending) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleDeny()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [pending, handleDeny])

  if (!pending) return null

  const appName = getAppName(pending.appId)

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={handleDeny}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative mx-4 flex w-full max-w-sm flex-col gap-3 rounded-xl border border-border bg-background p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="absolute top-3 right-3 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={handleDeny}
          type="button"
        >
          <X className="size-4" />
        </button>

        <div className="flex items-center gap-2 text-sm font-medium">
          <ClipboardPaste className="size-4 shrink-0" />
          <span>Allow clipboard access?</span>
        </div>

        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{appName}</span> wants to read your clipboard.
        </p>

        <div className="flex gap-2">
          <button
            className="flex flex-1 cursor-pointer items-center justify-center rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
            onClick={handleDeny}
            type="button"
          >
            Deny
          </button>
          <button
            className="flex flex-1 cursor-pointer items-center justify-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            onClick={handleAllow}
            type="button"
          >
            Allow
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
