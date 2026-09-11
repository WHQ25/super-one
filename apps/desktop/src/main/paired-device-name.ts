export const PAIRED_DEVICE_NAME_MAX = 64

/** Desktop pairing may override the phone's suggested name; empty falls back. */
export function resolvePairedDeviceDisplayName(
  edited: string | undefined,
  fallback: string,
): string {
  const pick = (value: string) => value.trim().replace(/\s+/g, ' ').slice(0, PAIRED_DEVICE_NAME_MAX)
  return pick(edited ?? '') || pick(fallback) || 'Mobile Device'
}
