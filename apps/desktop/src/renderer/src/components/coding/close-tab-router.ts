export type CloseTabTarget = 'terminal' | 'dock' | 'window'

export interface CloseTabHandlers {
  closeTerminal: () => void
  closeDock: () => void
  closeWindow: () => void
}

export function routeCloseTabShortcut(
  activeElement: Element | null,
  handlers: CloseTabHandlers,
  hasActiveDockTab = false,
): CloseTabTarget {
  const inActivity = !!activeElement?.closest('[data-activity-outer]')
  // The bottom coding terminal lives outside the activity panel and owns ⌘W over its
  // xterm surface. An activity-panel terminal tab is ALSO an xterm, but nested inside
  // [data-activity-outer]; it must close its dock tab, not the bottom terminal.
  if (activeElement?.closest('.xterm') && !inActivity) {
    handlers.closeTerminal()
    return 'terminal'
  }
  // Focus inside the activity panel, or inside one of its fixed host-layer overlays
  // (browser <webview>, panel-presentation mini-app) that portal out of the panel DOM
  // but still belong to the active dock tab.
  if (
    inActivity ||
    activeElement?.closest('[data-browser-host][data-browser-presentation="panel"]') ||
    activeElement?.closest('[data-miniapp-host][data-miniapp-presentation="panel"]')
  ) {
    handlers.closeDock()
    return 'dock'
  }
  // Focus is in limbo — e.g. right after a browser tab navigates from its home page,
  // the URL input unmounts and the fresh <webview> has not grabbed focus yet, so
  // activeElement falls back to <body>. dockview still knows which tab is active, so
  // close it. Closing the window is reserved for when no tab exists (Shift+⌘W also does it).
  if (hasActiveDockTab) {
    handlers.closeDock()
    return 'dock'
  }
  handlers.closeWindow()
  return 'window'
}
