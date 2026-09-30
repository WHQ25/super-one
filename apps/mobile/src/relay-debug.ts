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
 * Connection lifecycle diagnostics. Kept in release builds so `adb logcat` or
 * the device console can show why a reconnect failed. Fields are transport
 * facts only — never secrets, payloads, or event content.
 */
export function logConnection(step: string, fields: Record<string, string | number | boolean | null> = {}): void {
  console.info(`[reconnect] ${step}`, fields)
}
