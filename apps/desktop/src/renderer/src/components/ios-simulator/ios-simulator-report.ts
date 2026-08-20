import { toast } from 'sonner'

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// A single toast id: input and decode failures can repeat every frame, and five
// hundred stacked toasts say nothing that one replaced toast does not.
export function reportIosSimulatorError(message: string): void {
  toast.error(message, { id: 'ios-simulator-error' })
}

/** Confirms an action whose result is off-screen — detaching, shutting down. */
export function notifyIosSimulator(message: string): void {
  toast.success(message, { id: 'ios-simulator-status' })
}

/** Announces a saved capture with a one-click way to find the file on disk. */
export function notifyIosSimulatorCapture(
  message: string,
  revealLabel: string,
  path: string,
): void {
  toast.success(message, {
    id: 'ios-simulator-status',
    action: { label: revealLabel, onClick: () => { void window.app.revealFile(path) } },
  })
}
