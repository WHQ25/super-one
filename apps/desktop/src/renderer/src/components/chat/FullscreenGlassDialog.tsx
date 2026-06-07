import type { ReactNode } from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTitle,
  DialogDescription,
} from '@superone/ui/components/ui/dialog'

export function FullscreenGlassDialog({ open, onOpenChange, title, children }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="bg-transparent" />
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
          <DialogPrimitive.Content
            onOpenAutoFocus={(e) => e.preventDefault()}
            className="pointer-events-auto h-[90vh] w-[90vw] overflow-hidden rounded-lg border bg-[oklch(0.8_0_0/0.6)] shadow-[0_0_0_100vmax_rgba(0,0,0,0.5)] outline-none backdrop-blur-md backdrop-saturate-150 duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 dark:bg-background/70"
          >
            <span className="sr-only"><DialogTitle>{title}</DialogTitle></span>
            <span className="sr-only"><DialogDescription>{title}</DialogDescription></span>
            {children}
          </DialogPrimitive.Content>
        </div>
      </DialogPortal>
    </Dialog>
  )
}
