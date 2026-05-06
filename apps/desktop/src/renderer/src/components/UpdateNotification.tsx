import { AnimatePresence, motion } from 'motion/react'
import { CheckCircle, Download, Loader2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { useAppStore } from '@/stores/app'

export function UpdateNotification(): React.JSX.Element | null {
  const { t } = useTranslation()
  const updateStatus = useAppStore((s) => s.updateStatus)
  const updateVersion = useAppStore((s) => s.updateVersion)
  const updateProgress = useAppStore((s) => s.updateProgress)
  const installUpdate = useAppStore((s) => s.installUpdate)
  const dismissUpdate = useAppStore((s) => s.dismissUpdate)

  const show = updateStatus === 'checking' || updateStatus === 'preparing' || updateStatus === 'downloading' || updateStatus === 'ready' || updateStatus === 'up-to-date'

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ y: -80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -80, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-lg"
        >
          {updateStatus === 'checking' ? (
            <>
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
              <span className="text-sm">{t('shell.update.checking')}</span>
            </>
          ) : updateStatus === 'preparing' ? (
            <>
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
              <span className="text-sm">{t('shell.update.preparing', { version: updateVersion ? `v${updateVersion}` : '' })}</span>
              <button
                onClick={dismissUpdate}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </>
          ) : updateStatus === 'up-to-date' ? (
            <>
              <CheckCircle className="size-4 text-green-500" />
              <span className="text-sm">{t('shell.update.upToDate')}</span>
            </>
          ) : updateStatus === 'downloading' ? (
            <>
              <Loader2 className="size-4 animate-spin text-primary" />
              <span className="text-sm">
                {updateProgress > 0
                  ? t('shell.update.downloadingWithProgress', { version: updateVersion ? `v${updateVersion}` : 'update', progress: updateProgress })
                  : t('shell.update.downloading', { version: updateVersion ? `v${updateVersion}` : 'update' })}
              </span>
              <button
                onClick={dismissUpdate}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </>
          ) : (
            <>
              <Download className="size-4 text-primary" />
              <span className="text-sm">
                {t('shell.update.ready', { version: updateVersion })}
              </span>
              <Button size="sm" variant="default" onClick={import.meta.env.DEV ? dismissUpdate : installUpdate}>
                {t('shell.update.restart')}
              </Button>
              <button
                onClick={dismissUpdate}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
