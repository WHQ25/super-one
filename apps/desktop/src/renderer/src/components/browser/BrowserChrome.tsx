import { useCallback } from 'react'
import { ArrowLeft, ArrowRight, RotateCw, Camera, SquareDashedMousePointer } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@superone/ui/components/ui/tooltip'
import { CommandShortcut } from '@superone/ui/components/ui/command'
import { browserTabCanvas, useBrowserStore } from '@/stores/browser'
import { browserCapture } from './browser-host-api'
import { flattenBrowserCapture } from './browser-canvas'
import { isBlankUrl } from './browser-url'
import { BrowserOmnibox } from './BrowserOmnibox'
import { BrowserMoreMenu } from './BrowserMoreMenu'

const annotateShortcut = window.app.platform === 'darwin' ? '⌘.' : 'Ctrl+.'

interface BrowserChromeProps {
  browserId: string
  onNavigate: (input: string) => void
  onBack: () => void
  onForward: () => void
  onReload: () => void
}

export function BrowserChrome({ browserId, onNavigate, onBack, onForward, onReload }: BrowserChromeProps) {
  const { t } = useTranslation()
  const state = useBrowserStore((s) => s.tabs[browserId])
  const annotating = useBrowserStore((s) => s.annotatingId === browserId)
  const startAnnotate = useBrowserStore((s) => s.startAnnotate)
  const stopAnnotate = useBrowserStore((s) => s.stopAnnotate)
  const url = state?.url ?? ''
  const loading = state?.loading ?? false
  const isHome = isBlankUrl(url)

  const screenshot = useCallback(async () => {
    try {
      const img = await browserCapture(browserId)
      if (!img || img.isEmpty()) return
      const blob = await (await fetch(await flattenBrowserCapture(img, browserTabCanvas(browserId)))).blob()
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      toast.success(t('chat.browser.screenshotCopied'))
    } catch {
      toast.error(t('chat.browser.screenshotFailed'))
    }
  }, [browserId, t])

  return (
    <div className="relative flex h-9 shrink-0 items-center gap-0.5 border-b border-border bg-transparent px-2">
      <AnimatePresence>
        {loading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="pointer-events-none absolute inset-x-0 -bottom-px h-0.5 overflow-hidden"
          >
            <div className="browser-progress-bar h-full w-1/4 rounded-full bg-primary" />
          </motion.div>
        )}
      </AnimatePresence>
      <IconButton size="xs" variant="ghost" tooltip="Back" disabled={!state?.canGoBack} onClick={onBack}>
        <ArrowLeft className="size-3.5" />
      </IconButton>
      <IconButton size="xs" variant="ghost" tooltip="Forward" disabled={!state?.canGoForward} onClick={onForward}>
        <ArrowRight className="size-3.5" />
      </IconButton>
      <IconButton size="xs" variant="ghost" tooltip="Reload" onClick={onReload}>
        <RotateCw className="size-3" />
      </IconButton>
      <BrowserOmnibox browserId={browserId} url={url} isHome={isHome} onNavigate={onNavigate} />
      {annotating ? (
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
            <IconButton size="xs" variant="ghost" tooltip="Screenshot" disabled={isHome} onClick={screenshot}>
              <Camera className="size-3.5" />
            </IconButton>
            <IconButton
              size="xs"
              variant="ghost"
              tooltip={<span className="inline-flex items-center gap-1.5">{t('chat.browser.annotateEnter')}<CommandShortcut>{annotateShortcut}</CommandShortcut></span>}
              disabled={isHome}
              onClick={() => startAnnotate(browserId)}
            >
              <SquareDashedMousePointer className="size-3.5" />
            </IconButton>
          </>
        )}
      <BrowserMoreMenu browserId={browserId} isHome={isHome} />
    </div>
  )
}
