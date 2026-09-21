import log from '../logger'
import type { UiRootIdentity } from './types'

// Bound both memory and repeated polling noise. Changed state is logged immediately.
const recent = new Map<string, { payload: string; at: number }>()
export function computerUseDiagnostic(event: string, fields: Record<string, unknown>): void {
  try {
    const key = `${event}:${fields.sessionId ?? ''}:${fields.windowId ?? ''}`
    const payload = JSON.stringify(fields)
    const now = Date.now()
    const previous = recent.get(key)
    if (previous?.payload === payload && now - previous.at < 60_000) return
    recent.delete(key)
    recent.set(key, { payload, at: now })
    if (recent.size > 128) recent.delete(recent.keys().next().value!)
    log.info('[computer-use.diagnostic] %s %s', event, payload)
  } catch {
    // Diagnostics must never change an observation or input result.
  }
}

export function diagnosticRoot(root: Omit<UiRootIdentity, 'rootId'> & { rootId?: string }) {
  return {
    rootId: root.rootId, windowId: root.windowId, pid: root.pid,
    bundleId: root.bundleId, kind: root.kind, bounds: root.bounds,
    focused: root.focused, visible: root.visible, minimized: root.minimized,
    modal: root.modal, hasTitle: Boolean(root.title.trim()), hasAxRoot: Boolean(root.axRootId),
  }
}

/** Never log raw RPC params/results, error messages, titles, text or image data. */
export async function diagnoseHelperCall<T>(
  method: string,
  params: Record<string, unknown>,
  run: () => Promise<T>,
): Promise<T> {
  const context = {
    method, sessionId: params.sessionId, windowId: params.windowId ?? params.coordinateWindowId,
    pid: params.pid ?? params.targetPid, displayId: params.displayId,
    hasAxRoot: Boolean(params.axRootId ?? params.coordinateAxRootId),
  }
  try {
    const result = await run()
    const value = result as Record<string, unknown> | null
    if (method === 'list_windows') {
      computerUseDiagnostic('discovery', { ...context, diagnostics: value?.diagnostics ?? null })
    } else if (method === 'display_place_window') {
      computerUseDiagnostic('placement', {
        ...context, moved: value?.moved, bounds: value?.bounds, diagnostics: value?.diagnostics ?? null,
      })
    } else if (method === 'capture' || method === 'validate_geometry') {
      computerUseDiagnostic(method, { ...context, coordinateSpace: value?.coordinateSpace })
    } else if (method === 'launch_app' || method === 'focus_app') {
      computerUseDiagnostic(method, { ...context, activate: params.activate })
    }
    return result
  } catch (error) {
    // Codes are native constants; transport exceptions have no code. Do not copy messages.
    const rawCode = (error as { code?: unknown } | null)?.code
    const code = typeof rawCode === 'string' && /^[A-Z_]{1,64}$/.test(rawCode) ? rawCode : 'TRANSPORT_OR_UNKNOWN'
    computerUseDiagnostic('helper_failed', { ...context, code })
    throw error
  }
}
