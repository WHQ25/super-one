const PAIRING_QR_PREFIX = /^superone:\/\/pair(?:[/?#]|$)/i

const AUTOCORRECTED_PAIRING_SCHEME = /^super\s+one(?=:\/\/pair(?:[/?#]|$))/i

export function normalizePairingInput(value: string): string {
  return value.trim().replace(AUTOCORRECTED_PAIRING_SCHEME, 'superone')
}

export function isPairingQrInput(value: string): boolean {
  return PAIRING_QR_PREFIX.test(value)
}
