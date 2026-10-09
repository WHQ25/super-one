import { desktopPairQrKind } from '@superone/relay-client/desktop-pair'

const PAIRING_QR_PREFIX = /^superone:\/\/pair(?:[/?#]|$)/i

const AUTOCORRECTED_PAIRING_SCHEME = /^super\s+one(?=:\/\/pair(?:-controller|-node)?(?:[/?#]|$))/i

export function normalizePairingInput(value: string): string {
  return value.trim().replace(AUTOCORRECTED_PAIRING_SCHEME, 'superone')
}

/** A desktop's QR for pairing this phone. */
export function isPairingQrInput(value: string): boolean {
  return PAIRING_QR_PREFIX.test(value)
}

/** Any QR the pairing scanner handles: this phone, or two desktops through it. */
export function isAnyPairingInput(value: string): boolean {
  return isPairingQrInput(value) || desktopPairQrKind(value) !== null
}
