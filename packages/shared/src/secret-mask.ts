/**
 * How a secret is shown off the host that keeps it: its last six characters
 * at most, so a person can tell keys apart without the key leaving the host.
 */
export function maskSecret(secret: string): string {
  if (!secret) return ''
  if (secret.length <= 6) return '***'
  return `***${secret.slice(-6)}`
}
