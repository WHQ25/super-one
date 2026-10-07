import { recordDiagnostic, type DiagnosticFields } from './diagnostic-log'

/** Development logging stays payload-free so pairing and chat content never leak. */
export function logRelayEventTypes(events: unknown[]): void {
  if (!__DEV__) return
  console.debug('[relay] decrypted AgentEvents', events.map((event) => (
    event && typeof event === 'object' && 'type' in event
      ? String((event as { type: unknown }).type)
      : 'unknown'
  )))
}

/**
 * Connection lifecycle diagnostics. Kept in release builds, and uploaded to the
 * paired desktop's `mobile.log` (`diagnostic-log.ts`), so a reconnect that went
 * wrong can be read without the device console. Fields are transport facts only
 * — never secrets, payloads, or event content.
 */
export function logConnection(step: string, fields: DiagnosticFields = {}): void {
  console.info(`[reconnect] ${step}`, fields)
  recordDiagnostic('connection', { step, ...fields })
}

/** Workspace list sync: what invalidated a list, and what re-read it. Same rules as above. */
export function logSidebar(step: string, fields: DiagnosticFields = {}): void {
  console.info(`[sidebar] ${step}`, fields)
  recordDiagnostic('sidebar', { step, ...fields })
}
