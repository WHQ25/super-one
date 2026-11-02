/**
 * One process per userData profile.
 *
 * Electron's lock is a file in the userData directory, so `app.setPath` has to
 * run first. A named `SUPERONE_INSTANCE` (the desktop-node lab, e2e) therefore
 * keeps its own process. Stable and alpha already use different data
 * directories and stay side by side. A second launch of the same profile must
 * exit before it opens the database or binds a port; this process is told to
 * bring its main window forward.
 */

export interface SingleInstanceHost {
  requestSingleInstanceLock(): boolean
  on(event: 'second-instance', listener: () => void): void
  focus(options?: { steal: boolean }): void
}

export interface RevealableWindow {
  isDestroyed(): boolean
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
}

/** False means another process already owns this profile and this one must exit. */
export function takeSingleInstanceLock(host: { requestSingleInstanceLock(): boolean }): boolean {
  return host.requestSingleInstanceLock()
}

export function watchSecondInstance(host: { on(event: 'second-instance', listener: () => void): void }, reveal: () => void): void {
  host.on('second-instance', () => reveal())
}

/** Bring the existing main window forward. A destroyed window is left for the caller to recreate. */
export function revealPrimaryWindow(host: { focus(options?: { steal: boolean }): void }, win: RevealableWindow | null): void {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  host.focus({ steal: true })
  win.show()
  win.focus()
}
