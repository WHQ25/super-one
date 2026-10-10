import type { RealtimeVoiceStartRequest, RemoteCommand } from '@superone/shared/agent-types'
import type { VoiceIdentity, VoiceSession, VoiceStatus } from '@superone/shared/realtime-voice'
import type { VoiceControlPort } from './voice-service'

export function relayVoiceControl(client: { request(command: RemoteCommand): Promise<unknown> }, session: VoiceSession, additionalDirs?: string[], selection?: RealtimeVoiceStartRequest['selection']): VoiceControlPort {
  const request = async (command: Omit<Extract<RemoteCommand, { type: 'voice_status' }>, 'requestId'> | Omit<Extract<RemoteCommand, { type: 'voice_start' }>, 'requestId'> | Omit<Extract<RemoteCommand, { type: 'voice_stop' }>, 'requestId'> | Omit<Extract<RemoteCommand, { type: 'voice_ready' }>, 'requestId'>): Promise<VoiceStatus> => {
    const result = await client.request({ ...command, requestId: `voice-${Date.now()}-${Math.random().toString(36).slice(2)}` }) as VoiceStatus & { error?: string }
    if (result?.error) throw new Error(result.error)
    if (!result || result.protocol !== 1 || typeof result.supported !== 'boolean') throw new Error('Upgrade the desktop to enable voice.')
    return result
  }
  return {
    status: () => request({ type: 'voice_status', ...session }),
    start: (attemptId, sdp) => request({ type: 'voice_start', ...session, attemptId, request: { sdp, ...(additionalDirs ? { additionalDirs } : {}), ...(selection ? { selection } : {}) } }),
    stop: (attemptId, source = session) => request({ type: 'voice_stop', projectPath: source.projectPath, sessionId: source.sessionId, attemptId }),
    ready: (identity: VoiceIdentity) => request({ type: 'voice_ready', ...session, attemptId: identity.attemptId, identity }),
  }
}
