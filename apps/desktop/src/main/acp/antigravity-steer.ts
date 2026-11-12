import type { AgentEvent } from '@superone/shared/agent-types'
import type { XaiCorrelationState } from './acp-xai-session-notify'
import {
  closeAntigravityThinkingStep,
  extractAntigravityPromptResponseUsage,
  syncAntigravityTurnFromDb,
  type AntigravityTurnThinkingScope,
  type AntigravityWireTurnUsage,
} from './antigravity-runtime-bridge'
import {
  hasPendingAntigravitySubagentWakeup,
  resumeAntigravityTurnOnSteer,
  waitForAntigravitySubagentWakeup,
} from './antigravity-subagent'

export interface AntigravityPromptWireResponse {
  stopReason?: unknown
  usage?: unknown
}

export interface AntigravitySteerableTurn extends AntigravityTurnThinkingScope {
  readonly primaryMessageId: string
  lastMessageId: string | null
  superseded: boolean
  readonly onEvent: (event: AgentEvent) => void
}

export interface AntigravitySteerablePromptResult {
  stopReason: string
  usage: AntigravityWireTurnUsage | null
}

export interface AntigravitySteerablePrompt {
  readonly promise: Promise<AntigravitySteerablePromptResult>
  steer(sendNextLeg: () => Promise<AntigravityPromptWireResponse>): Promise<AntigravityWireTurnUsage | null>
  dispose(): void
}

interface PromptLegState {
  id: number
  admitted: boolean
  wireSettled: boolean
  wireUsage: AntigravityWireTurnUsage | null
  hasWireError: boolean
  wireError: unknown
  resolveWire: () => void
  wirePromise: Promise<void>
}

export function createAntigravitySteerablePrompt(opts: {
  sessionId: string
  turn: AntigravitySteerableTurn
  xaiCorrelation: XaiCorrelationState
  initialLeg: Promise<AntigravityPromptWireResponse>
}): AntigravitySteerablePrompt {
  let resolveFinal!: (result: AntigravitySteerablePromptResult) => void
  let rejectFinal!: (err: unknown) => void
  const promise = new Promise<AntigravitySteerablePromptResult>((resolve, reject) => {
    resolveFinal = resolve
    rejectFinal = reject
  })

  let finalSettled = false
  let activeLegId = 0

  const attachLeg = (
    id: number,
    admitted: boolean,
    legPromise: Promise<AntigravityPromptWireResponse>,
  ): PromptLegState => {
    let resolveWire!: () => void
    const wirePromise = new Promise<void>((resolve) => {
      resolveWire = resolve
    })
    const leg: PromptLegState = {
      id,
      admitted,
      wireSettled: false,
      wireUsage: null,
      hasWireError: false,
      wireError: null,
      resolveWire,
      wirePromise,
    }
    void legPromise.then(
      async (value) => {
        const usage = extractAntigravityPromptResponseUsage(value)
        leg.wireUsage = usage
        leg.wireSettled = true
        leg.resolveWire()
        if (id !== activeLegId || finalSettled) return
        let effectiveStopReason = String(value.stopReason ?? 'end_turn')
        await new Promise((r) => setTimeout(r, 0))
        if (id !== activeLegId || finalSettled) return
        if (
          effectiveStopReason === 'end_turn' &&
          !opts.turn.superseded &&
          hasPendingAntigravitySubagentWakeup(opts.sessionId)
        ) {
          const targetId = opts.turn.lastMessageId ?? opts.turn.primaryMessageId
          if (opts.turn.currentStepHasThinking && !opts.turn.currentStepThinkingClosed) {
            closeAntigravityThinkingStep(opts.turn, targetId, opts.turn.onEvent)
          }
          opts.turn.stepIndex += 1
          opts.turn.currentStepHasThinking = false
          opts.turn.currentStepHasThoughtText = false
          opts.turn.currentStepThinkingClosed = false
          opts.turn.stepStartedAt = Date.now()
          syncAntigravityTurnFromDb(
            opts.sessionId,
            targetId,
            opts.turn,
            opts.xaiCorrelation,
            opts.turn.onEvent,
            false,
            usage,
          )
          const wakeupOutcome = await waitForAntigravitySubagentWakeup(opts.sessionId)
          if (id !== activeLegId || finalSettled) return
          if (wakeupOutcome === 'cancelled' || opts.turn.superseded) {
            effectiveStopReason = 'cancelled'
          }
        }
        if (id !== activeLegId || finalSettled) return
        finalSettled = true
        resolveFinal({ stopReason: effectiveStopReason, usage })
      },
      (err) => {
        leg.hasWireError = true
        leg.wireError = err
        leg.wireSettled = true
        leg.resolveWire()
        if (!leg.admitted || id !== activeLegId || finalSettled) return
        finalSettled = true
        rejectFinal(err)
      },
    )
    return leg
  }

  let currentLeg = attachLeg(0, true, opts.initialLeg)

  return {
    promise,
    async steer(sendNextLeg) {
      if (finalSettled) throw new Error('Antigravity turn already settled')
      const prevLeg = currentLeg
      const wasWaitingOnWakeup = prevLeg.wireSettled
      const nextId = activeLegId + 1
      activeLegId = nextId
      let nextPromise: Promise<AntigravityPromptWireResponse>
      try {
        nextPromise = sendNextLeg()
      } catch (err) {
        activeLegId = prevLeg.id
        throw err
      }
      const nextLeg = attachLeg(nextId, false, nextPromise)
      if (!wasWaitingOnWakeup) {
        await Promise.race([prevLeg.wirePromise, nextLeg.wirePromise])
        if (nextLeg.hasWireError) {
          activeLegId = prevLeg.id
          throw nextLeg.wireError
        }
        nextLeg.admitted = true
        currentLeg = nextLeg
        return prevLeg.wireUsage
      }
      await Promise.race([
        nextLeg.wirePromise,
        new Promise<void>((resolve) => setTimeout(resolve, 0)),
      ])
      if (nextLeg.hasWireError) {
        activeLegId = prevLeg.id
        throw nextLeg.wireError
      }
      nextLeg.admitted = true
      currentLeg = nextLeg
      resumeAntigravityTurnOnSteer(opts.sessionId)
      return null
    },
    dispose() {
      finalSettled = true
    },
  }
}
