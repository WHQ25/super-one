import { create } from 'zustand'
import type { MediaComposerRequest, MediaComposerResult } from '@superone/shared/media-composer'
import { useComposerStacks } from '../composer-slot/composer-stack'

export interface MediaRun { requestId?: string; result?: MediaComposerResult; error?: string; delivery?: 'sending' | 'sent' | 'failed' }
export const useMediaRuns = create<{ runs: Record<string, MediaRun> }>(() => ({ runs: {} }))
let unwatch: (() => void) | undefined

function patch(id: string, run: MediaRun) {
  useMediaRuns.setState(state => ({ runs: { ...state.runs, [id]: run } }))
  watchEntries()
}

/** Jobs survive slot preemption. Removing their entry cancels only an in-flight submission. */
export async function runMediaGeneration(instanceId: string, request: MediaComposerRequest) {
  if (useMediaRuns.getState().runs[instanceId]?.requestId) return
  patch(instanceId, { requestId: request.requestId })
  try {
    const result = await window.environment.mediaGenerate(request)
    if (useMediaRuns.getState().runs[instanceId]?.requestId === request.requestId) patch(instanceId, { result })
  } catch (error) {
    if (useMediaRuns.getState().runs[instanceId]?.requestId === request.requestId) patch(instanceId, { error: error instanceof Error ? error.message : String(error) })
  }
}

function watchEntries() {
  unwatch ??= useComposerStacks.subscribe(state => {
    const keys = new Set(Object.values(state.sessions).flatMap(s => [s.base?.key, ...s.stack.map(e => e.key)]))
    for (const [id, run] of Object.entries(useMediaRuns.getState().runs)) {
      if (keys.has(id)) continue
      if (run.requestId) void window.environment.mediaCancel(run.requestId).catch(() => {})
      useMediaRuns.setState(state => { const runs = { ...state.runs }; delete runs[id]; return { runs } })
    }
    if (!Object.keys(useMediaRuns.getState().runs).length) { unwatch?.(); unwatch = undefined }
  })
}

export function setMediaResult(instanceId: string, result: MediaComposerResult) { patch(instanceId, { result }) }
export function markMediaDelivery(instanceId: string, delivery: MediaRun['delivery'], error?: string) {
  const run = useMediaRuns.getState().runs[instanceId]
  if (run) patch(instanceId, { ...run, delivery, error })
}

export async function cancelMediaGeneration(instanceId: string) {
  const id = useMediaRuns.getState().runs[instanceId]?.requestId
  if (id) await window.environment.mediaCancel(id)
}
