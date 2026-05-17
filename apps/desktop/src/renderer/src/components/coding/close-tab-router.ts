export type CloseTabTarget = 'terminal' | 'dock' | 'window'

export interface CloseTabHandlers {
  closeTerminal: () => void
  closeDock: () => void
  closeWindow: () => void
}

export function routeCloseTabShortcut(
  activeElement: Element | null,
  handlers: CloseTabHandlers,
): CloseTabTarget {
  if (activeElement?.closest('.xterm')) {
    handlers.closeTerminal()
    return 'terminal'
  }
  if (activeElement?.closest('[data-activity-outer]')) {
    handlers.closeDock()
    return 'dock'
  }
  handlers.closeWindow()
  return 'window'
}
