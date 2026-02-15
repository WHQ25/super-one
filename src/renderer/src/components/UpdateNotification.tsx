import { AnimatePresence, motion } from 'motion/react'
import { Download, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/stores/app'

export function UpdateNotification(): React.JSX.Element | null {
  const updateStatus = useAppStore((s) => s.updateStatus)
  const updateVersion = useAppStore((s) => s.updateVersion)
  const installUpdate = useAppStore((s) => s.installUpdate)
  const dismissUpdate = useAppStore((s) => s.dismissUpdate)

  return (
    <AnimatePresence>
      {updateStatus === 'ready' && (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-lg"
        >
          <Download className="size-4 text-primary" />
          <span className="text-sm">
            v{updateVersion} is ready
          </span>
          <Button size="sm" variant="default" onClick={installUpdate}>
            Restart
          </Button>
          <button
            onClick={dismissUpdate}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
