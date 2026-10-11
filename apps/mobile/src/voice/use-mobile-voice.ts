import { sessionLinkBaseClient } from '../session-link-navigation'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react'
import { AppState } from 'react-native'
import type { RelayClient } from '@superone/relay-client'
import type { AgentEvent, HarnessId, RealtimeVoiceStartRequest } from '@superone/shared/agent-types'
import type { VoiceCapability, VoiceStatus } from '@superone/shared/realtime-voice'
import type { ExecutionEnvironmentDescriptor } from '@superone/shared/environment/descriptor'
import { MobileVoiceService, supportedVoice, type VoiceTarget } from './voice-service'
import { nativeVoiceMedia } from './native-voice-media'
import { relayVoiceControl } from './relay-voice-control'
import { bindVoiceLifecycle } from './voice-lifecycle'

export function useMobileVoice(input: {
  clientRef: RefObject<RelayClient | null>; target: VoiceTarget | null
  connected: boolean; routed: boolean; additionalDirs: string[]; providerId?: string | null
  streaming?: boolean
  selection: RealtimeVoiceStartRequest['selection']; catalogReady: boolean
  sessionCapability?: VoiceCapability
  landing?: { projectPath: string; harnessId: HarnessId; capability?: VoiceCapability; create(signal: AbortSignal): Promise<VoiceTarget> }
}) {
  const service = useMemo(() => new MobileVoiceService(nativeVoiceMedia), [])
  const state = useSyncExternalStore(service.subscribe, service.snapshot)
  const [capability, setCapability] = useState<VoiceCapability>()
  const client = input.clientRef.current
  const baseClient = client ? sessionLinkBaseClient(client) : null
  const previousClient = useRef(baseClient)
  useEffect(() => {
    if (previousClient.current && previousClient.current !== baseClient) service.stop()
    previousClient.current = baseClient
  }, [service, baseClient])
  const projectPath = input.target?.projectPath ?? input.landing?.projectPath
  const sessionId = input.target?.sessionId
  const harnessId = input.target?.harnessId ?? input.landing?.harnessId
  useEffect(() => {
    let current = true
    setCapability(undefined)
    if (client && projectPath && input.connected && !input.routed) {
      void (async () => {
        const descriptor = await client.rpc<ExecutionEnvironmentDescriptor>('environment.descriptor')
        if (!['session.voiceStatus', 'session.voiceStart', 'session.voiceStop', 'session.voiceReady'].every(method => descriptor.capabilities.methods.includes(method))) return
        let next = input.landing?.capability
        if (sessionId) {
          const project = await client.resolveProject(projectPath)
          const status = await client.rpc<VoiceStatus>('session.voiceStatus', { sessionId }, { environmentId: project.environmentId })
          next = { protocol: status.protocol, supported: status.supported, ...(status.reason ? { reason: status.reason } : {}) }
        }
        if (current) setCapability(next)
      })().catch(() => { if (current) setCapability(undefined) })
    }
    return () => { current = false }
  }, [client, projectPath, sessionId, input.connected, input.routed, input.providerId, harnessId, input.landing?.capability, input.sessionCapability])
  useEffect(() => {
    return bindVoiceLifecycle(AppState, () => service.background(), () => service.stop())
  }, [service])
  useEffect(() => { service.connection(input.connected) }, [service, input.connected])
  const supportedSelection = input.catalogReady && supportedVoice(capability, harnessId as HarnessId | undefined, input.providerId)
  const start = () => {
    if (!client || !input.connected || input.routed || input.streaming || !supportedSelection) return
    const control = (target: VoiceTarget) => relayVoiceControl(client, target, input.additionalDirs, input.selection)
    if (input.target) void service.start(input.target, control(input.target))
    else if (input.landing) void service.startNew(input.landing.create, control)
  }
  return {
    service, state, start, retry: () => state.target ? service.retry() : start(), capability: supportedSelection ? capability : undefined,
    supported: supportedSelection && service.available() && !input.routed,
    ingest(events: unknown[]) {
      for (const raw of events) {
        const event = raw as AgentEvent
        if (event.type === 'realtime_call_signal' && event.sessionId && event.projectPath) service.signal(event.signal, { sessionId: event.sessionId, projectPath: event.projectPath })
        const lost = raw as import('@superone/shared/environment/events').ControlLostEvent
        if (lost.type === 'control_lost' && lost.resource.environmentId === baseClient?.environmentId
          && 'sessionId' in lost.resource && lost.resource.sessionId === service.snapshot().target?.sessionId) service.stop()
      }
    },
  }
}
