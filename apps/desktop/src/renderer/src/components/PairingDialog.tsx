import type { ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@superone/ui/components/ui/dialog'

/**
 * The dialog every pairing flow runs in: the QR to scan, then the code.
 * `locked` keeps it open while the pairing finishes.
 */
export function PairingDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  locked?: boolean
  children: ReactNode
}) {
  return (
    <Dialog open={props.open} onOpenChange={(next) => !props.locked && props.onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription className="sr-only">{props.description}</DialogDescription>
        </DialogHeader>
        {props.children}
      </DialogContent>
    </Dialog>
  )
}
