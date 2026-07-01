import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, RotateCw, ExternalLink, Camera, SquareDashedMousePointer, MoreHorizontal, Code } from 'lucide-react'
import { motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { cn } from '@superone/ui/lib/utils'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@superone/ui/components/ui/tooltip'
import { CommandShortcut } from '@superone/ui/components/ui/command'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@superone/ui/components/ui/dropdown-menu'
import { useBrowserStore } from '@/stores/browser'
import { browserCapture, browserOpenDevTools } from './browser-host-api'
import { isBlankUrl } from './browser-url'

const annotateShortcut = window.app.platform === 'darwin' ? '⌘.' : 'Ctrl+.'

interface BrowserChromeProps {
  browserId: string
  onNavigate: (input: string) => void
  onBack: () => void
  onForward: () => void
  onReload: () => void
  onStop: () => void
}

export function BrowserChrome({ browserId, onNavigate, onBack, onForward, onReload, onStop }: BrowserChromeProps) {
  const { t } = useTranslation()
  const state = useBrowserStore((s) => s.tabs[browserId])
  const annotating = useBrowserStore((s) => s.annotatingId === browserId)
  const startAnnotate = useBrowserStore((s) => s.startAnnotate)
  const stopAnnotate = useBrowserStore((s) => s.stopAnnotate)
  const url = state?.url ?? ''
  const loading = state?.loading ?? false
  const [draft, setDraft] = useState(url)
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const isHome = isBlankUrl(url)

  useEffect(() => {
    if (!editing) setDraft(isHome ? '' : url)
  }, [url, editing, isHome])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    inputRef.current?.blur()
    onNavigate(draft)
  }

  const screenshot = useCallback(async () => {
    try {
      const img = await browserCapture(browserId)
      if (!img || img.isEmpty()) return
      const blob = await (await fetch(img.toDataURL())).blob()
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      toast.success(t('chat.browser.screenshotCopied'))
    } catch {
      toast.error(t('chat.browser.screenshotFailed'))
    }
  }, [browserId, t])

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
        <RotateCw className={cn('size-3', loading && 'animate-spin')} />
      </IconButton>
      <form onSubmit={submit} className="group relative mx-1 min-w-0 flex-1">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => { setEditing(true); e.target.select() }}
          onBlur={() => setEditing(false)}
          spellCheck={false}
          placeholder={t('chat.browser.addressPlaceholder')}
          className={cn(
            'h-6 w-full rounded-md bg-transparent px-1.5 text-xs text-foreground outline-none transition-all hover:bg-muted focus:bg-muted focus:ring-1 focus:ring-border/60',
            !isHome && url && 'group-hover:pr-7',
            editing ? 'text-left' : 'text-center',
          )}
        />
        {!isHome && url && (
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
      {!isHome &&
        (annotating ? (
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <motion.button
                  type="button"
                  onClick={stopAnnotate}
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary outline-none transition-colors hover:bg-primary/15 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <SquareDashedMousePointer className="size-3.5 shrink-0" />
                  <motion.span
                    initial={{ width: 0, opacity: 0 }}
                    animate={{ width: 'auto', opacity: 1 }}
                    transition={{ duration: 0.1, ease: 'easeOut'}}
                    className="overflow-hidden whitespace-nowrap"
                  >
                    {t('chat.browser.annotating')}
                  </motion.span>
                </motion.button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={6} className="inline-flex items-center gap-1.5">
                {t('chat.browser.annotateExit')}<CommandShortcut>{annotateShortcut}</CommandShortcut>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <>
            <IconButton size="xs" variant="ghost" tooltip="Screenshot" onClick={screenshot}>
              <Camera className="size-3.5" />
            </IconButton>
            <IconButton
              size="xs"
              variant="ghost"
              tooltip={<span className="inline-flex items-center gap-1.5">{t('chat.browser.annotateEnter')}<CommandShortcut>{annotateShortcut}</CommandShortcut></span>}
              onClick={() => startAnnotate(browserId)}
            >
              <SquareDashedMousePointer className="size-3.5" />
            </IconButton>
          </>
        ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton size="xs" variant="ghost" tooltip="More">
            <MoreHorizontal className="size-3.5" />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => browserOpenDevTools(browserId)}>
            <Code className="size-3.5" />
            Open DevTools
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
