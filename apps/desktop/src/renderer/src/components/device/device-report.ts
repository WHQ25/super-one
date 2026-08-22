import { toast } from 'sonner'

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// A single toast id: input and decode failures can repeat every frame, and five
// hundred stacked toasts say nothing that one replaced toast does not.
export function reportDeviceError(message: string): void {
  toast.error(message, { id: 'device-error' })
}

/** Confirms an action whose result is off-screen — detaching, shutting down. */
export function notifyDevice(message: string): void {
  toast.success(message, { id: 'device-status' })
}

/** Announces a saved capture with a one-click way to find the file on disk. */
export function notifyDeviceCapture(
  message: string,
  revealLabel: string,
  path: string,
): void {
  toast.success(message, {
    id: 'device-status',
    action: { label: revealLabel, onClick: () => { void window.app.revealFile(path) } },
  })
}
