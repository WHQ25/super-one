import type { WebContents } from 'electron'
import { AgentIpcChannels, type RealtimeVoiceStartRequest } from '@superone/shared/agent-types'
import type { VoiceIdentity } from '@superone/shared/realtime-voice'
import type { SessionManagerImpl } from '../session/session-manager'
import type { Session } from '../session/types'
import type { VoiceEndpoint } from '../session/realtime-voice-host'

export function preferredVoiceRequest(request: RealtimeVoiceStartRequest, preferred: string): RealtimeVoiceStartRequest {
  return request.voice || !preferred ? request : { ...request, voice: preferred }
}

export function windowVoiceEndpoint(sender: WebContents, session: Session): VoiceEndpoint {
  const endpoint: VoiceEndpoint = {
    id: `window:${sender.id}`,
    onDisconnect: listener => {
      sender.once('destroyed', listener); sender.on('did-navigate', listener)
      return () => { sender.removeListener('destroyed', listener); sender.removeListener('did-navigate', listener) }
    },
    send: signal => {
      if (!sender.isDestroyed()) sender.send(AgentIpcChannels.EVENT, { type: 'realtime_call_signal', sessionId: session.id, projectPath: session.projectPath, signal })
    },
  }
  return endpoint
}

export function readyWindowVoice(manager: SessionManagerImpl, session: Session, sender: WebContents, identity: VoiceIdentity): void {
  manager.realtimeVoice.ready(session, windowVoiceEndpoint(sender, session), identity)
}
