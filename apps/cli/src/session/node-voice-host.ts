import { randomUUID } from 'node:crypto'
import { createCodexAgentEventMapper, type CodexAgentEventMapper } from '@superone/codex'
import type { AgentEvent, RealtimeVoiceStartRequest } from '@superone/shared/agent-types'
import { VoiceAdmissionHost, voiceSupport, type VoiceSeat } from '@superone/shared/realtime-voice-admission'
import {
  buildCodexRealtimeStartParams,
  codexThreadSettingsParams,
  createRealtimeStartClock,
  mapCodexRealtimeNotification,
} from '@superone/shared/realtime-voice-codex'
import { VoiceCleanupPendingError, type VoiceIdentity, type VoiceSignal, type VoiceStatus } from '@superone/shared/realtime-voice'
import type { CodexVoiceConnection, NodeSessionRecord } from '@superone/runtime/session'

export interface NodeVoiceDeps {
  endpointId: string
  session: NodeSessionRecord
  projectPath: string
  open(session: NodeSessionRecord): Promise<CodexVoiceConnection>
  publish(event: AgentEvent): void
  send(signal: VoiceSignal): void
  onThread(threadId: string): void
}

/** One voice call on this node. Admission is shared; this link drives the node's Codex app-server. */
export class NodeVoiceHost {
  private readonly admission = new VoiceAdmissionHost()

  private seat(deps: NodeVoiceDeps): VoiceSeat {
    return {
      endpointId: deps.endpointId,
      sessionId: deps.session.sessionId,
      projectPath: deps.projectPath,
      capability: voiceSupport({ harnessId: deps.session.harnessId, apiProviderId: deps.session.apiProviderId }),
      busy: deps.session.status === 'streaming',
      apiProviderId: deps.session.apiProviderId,
      send: deps.send,
    }
  }

  status(deps: NodeVoiceDeps): VoiceStatus {
    return this.admission.status(this.seat(deps))
  }

  start(deps: NodeVoiceDeps, attemptId: string, request: RealtimeVoiceStartRequest): VoiceStatus {
    return this.admission.start(this.seat(deps), attemptId, request, (control) => {
      let connection: CodexVoiceConnection | null = null
      let unsubscribe = () => {}
      let mapper: CodexAgentEventMapper | null = null
      const stamp = createRealtimeStartClock()
      const publish = (event: AgentEvent) => { if (control.current) deps.publish(event) }
      const feedDelegated = (notification: { method: string; params: Record<string, unknown> }) => {
        const method = notification.method
        const opensTurn = method === 'turn/started' || method.startsWith('item/')
        if (!mapper && !opensTurn) return
        if (!mapper) {
          mapper = createCodexAgentEventMapper({
            messageId: `codex_realtime_${randomUUID()}`,
            emit: (event) => publish(event),
          })
          mapper.start(connection?.threadId ?? '')
          control.setDeferRelease(true)
        }
        const result = mapper.apply(notification)
        if (result.completed || result.error || result.interrupted) {
          mapper = null
          control.setDeferRelease(false)
        }
      }
      return {
        async start(next) {
          connection = await deps.open(deps.session)
          if (!control.current) {
            connection.setVoiceActive(false)
            connection = null
            return
          }
          deps.onThread(connection.threadId)
          unsubscribe = connection.subscribe((notification) => {
            if (!control.current) return
            if (notification.method.startsWith('thread/realtime/')) {
              const mapped = mapCodexRealtimeNotification(notification)
              if (!mapped) return
              const event = stamp(mapped)
              if (event.type !== 'realtime_sdp') publish(event)
              control.receive(event)
              return
            }
            feedDelegated(notification)
          })
          connection.setVoiceActive(true)
          if (control.cancelled) return
          const selection = next.selection
          await connection.request('thread/settings/update', codexThreadSettingsParams(connection.threadId, {
            model: selection?.model?.trim() || deps.session.model,
            effort: selection?.reasoningEffort || deps.session.effort,
            serviceTier: selection && 'serviceTier' in selection ? selection.serviceTier : undefined,
          }, { includeServiceTier: !!selection && 'serviceTier' in selection }))
          if (!control.current || control.cancelled) return
          try {
            await connection.request('thread/realtime/start', buildCodexRealtimeStartParams(connection.threadId, next))
          } catch (error) {
            throw new VoiceCleanupPendingError(error instanceof Error ? error.message : 'Voice could not start.')
          }
        },
        async stop() {
          if (!connection) return
          await connection.request('thread/realtime/stop', { threadId: connection.threadId })
        },
        release() {
          unsubscribe()
          unsubscribe = () => {}
          connection?.setVoiceActive(false)
          connection = null
          mapper = null
        },
      }
    })
  }

  ready(deps: NodeVoiceDeps, identity: VoiceIdentity): VoiceStatus {
    return this.admission.ready(this.seat(deps), identity)
  }

  stop(deps: NodeVoiceDeps, attemptId: string): Promise<VoiceStatus> {
    return this.admission.stop(this.seat(deps), attemptId)
  }

  /** Drop an in-process call. Tests use this so a timer cannot outlive the case. */
  reset(): void {
    this.admission.reset()
  }
}

export const nodeVoiceHost = new NodeVoiceHost()
