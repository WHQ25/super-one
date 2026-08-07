/**
 * Structured connection diagnostics helpers (PR6).
 * Keep payloads redaction-safe: no tokens, PEMs, or pairing secrets.
 */

export type ConnectionLogEvent =
  | {
      type: 'connect_attempt'
      connectionId: string
      environmentId?: string
      generation: number
      attempt: number
      reason?: string
    }
  | {
      type: 'connect_result'
      connectionId: string
      state: string
      attempt: number
      generation: number
      error?: string
      blockReason?: string
    }
  | {
      type: 'wake'
      connectionId?: string
      reason: string
    }
  | {
      type: 'endpoint_selected'
      connectionId: string
      endpointId: string
      kind?: string
    }

export function formatConnectionLog(event: ConnectionLogEvent): string {
  return `[environment] ${JSON.stringify(event)}`
}
