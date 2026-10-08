/**
 * The explicit error for a method this host does not serve. A whole family a
 * host lacks the port for answers this from the dispatcher; a port that serves
 * a family partially throws it for the methods it leaves out.
 */
export function unsupportedMethodError(method: string): Error & {
  code: 'not_found'
  details: { method: string; unsupported: true }
} {
  return Object.assign(new Error(`unsupported method on this environment: ${method}`), {
    code: 'not_found' as const,
    details: { method, unsupported: true as const },
  })
}
