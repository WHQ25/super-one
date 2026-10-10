import { sessionLinkBaseClient } from '../session-link-navigation'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react'
import { AppState } from 'react-native'
import type { RelayClient, SessionSnapshot } from '@superone/relay-client'
import type { AgentEvent, HarnessId, RealtimeVoiceStartRequest } from '@superone/shared/agent-types'
import type { VoiceCapability } from '@superone/shared/realtime-voice'
import { MobileVoiceService, supportedVoice, type VoiceTarget } from './voice-service'
import { nativeVoiceMedia } from './native-voice-media'
import { relayVoiceControl } from './relay-voice-control'
import { bindVoiceLifecycle } from './voice-lifecycle'

export function useMobileVoice(input: {
  clientRef: RefObject<RelayClient | null>; target: VoiceTarget | null
  connected: boolean; routed: boolean; additionalDirs: string[]; providerId?: string | null
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
    setCapability(input.connected && !input.routed && sessionId ? input.sessionCapability : undefined)
    if (client && projectPath && sessionId && input.connected && !input.routed) {
      void client.request({ type: 'get_session_state', requestId: `voice-capability-${Date.now()}`, projectPath, sessionId }).then(raw => {
        if (current) setCapability((raw as SessionSnapshot).realtimeVoice)
      }).catch(() => {})
    } else if (client && projectPath && !sessionId && input.connected && !input.routed) {
      setCapability(input.landing?.capability)
    }
    return () => { current = false }
  }, [client, projectPath, sessionId, input.connected, input.routed, input.providerId, harnessId, input.landing?.capability, input.sessionCapability])
  useEffect(() => {
    // iOS permission prompts temporarily report inactive. Only real background
    // (also emitted after screen lock) ends capture. Foreground never restarts it.
    return bindVoiceLifecycle(AppState, () => service.background())
  }, [service])
  useEffect(() => { service.connection(input.connected) }, [service, input.connected])
  const supportedSelection = input.catalogReady && supportedVoice(capability, harnessId as HarnessId | undefined, input.providerId)
  const start = () => {
    if (!client || !input.connected || input.routed || !supportedSelection) return
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
      }
    },
  }
}
