import { targetIdentity } from './app-identity'
import { bindCondition, evaluateBoundCondition } from './condition-evaluation'
import { throwIfAborted } from './async-control'
import type { CaptureScope, ComputerUseState, Condition, ObserveMode, ObserveResult, WaitResult } from './types'

export interface WaitForDeps {
  observe(root: string, mode: ObserveMode, capture: CaptureScope): Promise<ObserveResult>
  requireState(id: string): ComputerUseState
  delay(ms: number, signal?: AbortSignal): Promise<void>
}

export async function waitForCondition(base: ComputerUseState, condition: Condition, timeoutMs: number, deps: WaitForDeps, signal?: AbortSignal): Promise<WaitResult> {
  const binding = bindCondition(condition, base.outline)

  // preexisting: condition already true on base state
  if (evaluateBoundCondition(binding, base.outline)) {
    // Still produce a successor observation for a stable stateId contract.
    const obs = await deps.observe(base.root.rootId, base.mode, base.capture)
    throwIfAborted(signal)
    return {
      status: 'preexisting',
      successorStateId: obs.stateId,
      successorRoot: targetIdentity(obs.root),
    }
  }

  // Poll on the AX outline alone. Conditions never read the screenshot, and a
  // capture every 50ms is what the user sees as the software cursor flickering.
  // `visual` has no AX outline to poll, so it keeps its own mode.
  const pollMode: ObserveMode = base.mode === 'visual' ? 'visual' : 'semantic'
  const interval = 50
  const maxAttempts = Math.max(1, Math.ceil(timeoutMs / interval))
  for (let i = 0; i < maxAttempts; i++) {
    throwIfAborted(signal)
    await deps.delay(interval, signal)

    const obs = await deps.observe(base.root.rootId, pollMode, base.capture)
    throwIfAborted(signal)
    const state = deps.requireState(obs.stateId)
    if (evaluateBoundCondition(binding, state.outline)) {
      const successor = pollMode === base.mode ? obs : await deps.observe(base.root.rootId, base.mode, base.capture)
      throwIfAborted(signal)
      return {
        status: 'verified',
        successorStateId: successor.stateId,
        successorRoot: targetIdentity(successor.root),
      }
    }
  }

  const last = await deps.observe(base.root.rootId, base.mode, base.capture)
  throwIfAborted(signal)
  return {
    status: 'failed',
    successorStateId: last.stateId,
    successorRoot: targetIdentity(last.root),
  }
}
