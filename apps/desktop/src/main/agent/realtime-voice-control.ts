import type { WebContents } from 'electron'
import { AgentIpcChannels, type RealtimeVoiceStartRequest } from '@superone/shared/agent-types'
import type { VoiceCommand, VoiceIdentity } from '@superone/shared/realtime-voice'
import type { SessionManagerImpl } from '../session/session-manager'
import type { Session } from '../session/types'
import type { RemoteControlService } from '../remote-control-service'
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

export async function executeVoiceCommand(command: VoiceCommand, ports: {
  manager: SessionManagerImpl; deviceId: string; transport?: RemoteControlService
  canAccess(projectPath: string, sessionId: string): boolean; preferredVoice: string
}): Promise<unknown> {
  if (!ports.deviceId || ports.deviceId === 'unknown-device') throw new Error('Authenticated pairing is required for voice.')
  if (!ports.canAccess(command.projectPath, command.sessionId)) throw new Error('Session access denied.')
  const session = ports.manager.getSession(command.sessionId) ?? ports.manager.resumeSession(command.sessionId, { passive: true })
  if (session.projectPath !== command.projectPath) throw new Error('Session project mismatch.')
  const endpoint: VoiceEndpoint = {
    id: `phone:${ports.deviceId}`, deviceId: ports.deviceId,
    send: signal => { void ports.transport?.sendEventToMobile({ type: 'realtime_call_signal', sessionId: session.id, projectPath: session.projectPath, signal }, [ports.deviceId]).catch(() => {}) },
  }
  const host = ports.manager.realtimeVoice
  if (command.type === 'voice_status') { host.reconnect(session, endpoint); return host.status(session, endpoint) }
  if (command.type === 'voice_start') return host.start(session, endpoint, command.attemptId, preferredVoiceRequest(command.request, ports.preferredVoice))
  if (command.type === 'voice_stop') return host.stop(session, endpoint, command.attemptId)
  return host.ready(session, endpoint, command.identity)
}

export function readyWindowVoice(manager: SessionManagerImpl, session: Session, sender: WebContents, identity: VoiceIdentity): void {
  manager.realtimeVoice.ready(session, windowVoiceEndpoint(sender, session), identity)
}
