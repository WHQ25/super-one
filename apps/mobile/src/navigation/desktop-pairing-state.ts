import type { DesktopPairQr, SavedPairing } from '@superone/relay-client'
import { deviceLabel } from '../ui/device-row'

/** Where pairing two desktops through this phone stands (see `useDesktopPairing`). */
export type DesktopPairingState =
  | { step: 'choose'; qr: DesktopPairQr; candidates: SavedPairing[] }
  /** Controller QR: the person types this code on the scanned desktop. */
  | { step: 'show-code'; qr: DesktopPairQr; other: SavedPairing; code: string }
  /** Node QR: waiting for the scanned desktop to show its code. */
  | { step: 'connecting'; qr: DesktopPairQr; other: SavedPairing }
  | { step: 'enter-code'; qr: DesktopPairQr; other: SavedPairing; mismatch: boolean }
  | { step: 'working'; qr: DesktopPairQr; other: SavedPairing }
  | { step: 'done'; qr: DesktopPairQr; other: SavedPairing }
  | { step: 'failed'; message: string }

/** Who controls whom, for the screen: the controller first. */
export function pairingDirection(state: { qr: DesktopPairQr; other: SavedPairing }): { controller: string; node: string } {
  const other = deviceLabel(state.other)
  return state.qr.kind === 'controller'
    ? { controller: other, node: state.qr.desktopName }
    : { controller: state.qr.desktopName, node: other }
}
