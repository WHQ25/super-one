/**
 * Event-trace adapter for Cursor SDK payloads.
 *
 * Desktop injects `trace` from `apps/desktop/src/main/agent/event-trace.ts`.
 * Matches Claude: raw SDK objects go to `agent.sdk` with the native type and
 * messageId tag. Host lifecycle (create / send / retry) uses `cursor.runtime`.
 */

export type CursorSdkTraceFn = (
  source: string,
  type: string,
  data: unknown,
  tag?: string,
) => void

export interface CursorSdkTracer {
  sdk(type: string, data: unknown, tag?: string): void
  runtime(type: string, data: unknown, tag?: string): void
}

export function createCursorSdkTracer(onSdkTrace?: CursorSdkTraceFn): CursorSdkTracer {
  const emit = (source: string, type: string, data: unknown, tag?: string) => {
    if (!onSdkTrace) return
    try {
      onSdkTrace(source, type, data, tag)
    } catch {
      // Tracing must never break a turn.
    }
  }
  return {
    sdk(type, data, tag) {
      emit('agent.sdk', type || 'unknown', data, tag)
    },
    runtime(type, data, tag) {
      emit('cursor.runtime', type || 'unknown', data, tag)
    },
  }
}

export function cursorSdkType(value: unknown, fallback: string): string {
  if (!value || typeof value !== 'object') return fallback
  const type = (value as { type?: unknown }).type
  return typeof type === 'string' && type ? type : fallback
}

/** user_send payload — keep text raw; drop image bytes so the trace DB stays usable. */
export function cursorUserSendTracePayload(message: unknown): unknown {
  if (typeof message === 'string') return { text: message }
  if (!message || typeof message !== 'object') return message
  const rec = message as { text?: unknown; images?: Array<{ data?: unknown; mimeType?: unknown }> }
  if (!Array.isArray(rec.images)) return message
  return {
    text: rec.text,
    images: rec.images.map((img) => ({
      mimeType: typeof img?.mimeType === 'string' ? img.mimeType : '',
      bytes: typeof img?.data === 'string' ? img.data.length : 0,
    })),
  }
}
