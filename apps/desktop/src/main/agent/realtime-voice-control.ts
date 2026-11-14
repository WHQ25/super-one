import type { WebContents } from 'electron'
import { AgentIpcChannels, type RealtimeVoiceStartRequest } from '@superone/shared/agent-types'
import type { VoiceIdentity } from '@superone/shared/realtime-voice'
import type { SessionManagerImpl } from '../session/session-manager'
import type { Session } from '../session/types'
import type { VoiceSeat } from '@superone/shared/realtime-voice-admission'
import type { VoiceEndpoint } from '../session/realtime-voice-host'

export function preferredVoiceRequest(request: RealtimeVoiceStartRequest, preferred: string): RealtimeVoiceStartRequest {
  return request.voice || !preferred ? request : { ...request, voice: preferred }
}

export function windowVoiceEndpoint(sender: WebContents, target: { id: string; projectPath: string }): VoiceEndpoint {
  const endpoint: VoiceEndpoint = {
    id: `window:${sender.id}`,
    onDisconnect: listener => {
      sender.once('destroyed', listener); sender.on('did-navigate', listener)
      return () => { sender.removeListener('destroyed', listener); sender.removeListener('did-navigate', listener) }
    },
    send: signal => {
      if (!sender.isDestroyed()) sender.send(AgentIpcChannels.EVENT, { type: 'realtime_call_signal', sessionId: target.id, projectPath: target.projectPath, signal })
    },
  }
  return endpoint
}

/** Seat for a call whose session is not loaded on this desktop. */
export function voiceSeatFor(endpoint: VoiceEndpoint, target: { id: string; projectPath: string }): VoiceSeat {
  return {
    endpointId: endpoint.id,
    sessionId: target.id,
    projectPath: target.projectPath,
    capability: { protocol: 1, supported: false, reason: 'Voice is unavailable for this agent.' },
    busy: false,
    send: signal => endpoint.send(signal),
  }
}

/** Seat for stopping a call whose session is not loaded on this desktop. */
export function windowVoiceSeat(sender: WebContents, target: { id: string; projectPath: string }): VoiceSeat {
  return voiceSeatFor(windowVoiceEndpoint(sender, target), target)
}

export function readyWindowVoice(manager: SessionManagerImpl, session: Session, sender: WebContents, identity: VoiceIdentity): void {
  manager.realtimeVoice.ready(session, windowVoiceEndpoint(sender, session), identity)
}
