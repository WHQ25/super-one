/** Development logging stays payload-free so pairing and chat content never leak. */
export function logRelayEventTypes(events: unknown[]): void {
  if (!__DEV__) return
  console.debug('[relay] decrypted AgentEvents', events.map((event) => (
    event && typeof event === 'object' && 'type' in event
      ? String((event as { type: unknown }).type)
      : 'unknown'
  )))
}
