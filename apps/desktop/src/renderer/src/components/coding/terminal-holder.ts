import { NODE_WINDOW_TERMINAL_OWNER } from '@superone/shared/remote-resource-key'

/** Who writes in a terminal tab, as this window sees it. */
export type TerminalHolder = 'me' | 'host' | 'phone' | 'desktop'

/**
 * A tab's writer from its `ownerDeviceId`: none is this window; a remote tab
 * its node's own window took back is that computer; `node:` ids are
 * controller desktops; any other id is a phone.
 */
export function terminalHolder(ownerDeviceId: string | null | undefined): TerminalHolder {
  if (!ownerDeviceId) return 'me'
  if (ownerDeviceId === NODE_WINDOW_TERMINAL_OWNER) return 'host'
  return ownerDeviceId.startsWith('node:') ? 'desktop' : 'phone'
}
