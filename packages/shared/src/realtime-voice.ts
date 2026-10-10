import type { RealtimeVoiceStartRequest } from './agent-types'
import { isCodexAccountProvider } from './codex-accounts'

export const REALTIME_VOICE_PROTOCOL = 1 as const
export const REALTIME_VOICE_MARK_SIZE = 84
export const REALTIME_VOICE_GLYPH_SIZE = 30
export const REALTIME_VOICE_GLYPH_SCALE = REALTIME_VOICE_GLYPH_SIZE / REALTIME_VOICE_MARK_SIZE
export const VOICE_START_TIMEOUT_MS = 30_000
export const VOICE_DISCONNECT_GRACE_MS = 8_000
export const MAX_VOICE_SDP_CHARS = 128_000
export class VoiceCleanupPendingError extends Error {}

export type VoiceSession = { projectPath: string; sessionId: string }
export type VoiceIdentity = { hostEpoch: string; callId: string; generation: number; attemptId: string }
export type VoicePhase = 'starting' | 'active' | 'stopping'
export type VoiceCapability = { protocol: 1; supported: boolean; reason?: string }
export type VoiceStatus = VoiceCapability & {
  call: (VoiceIdentity & VoiceSession & { state: VoicePhase; owned: boolean }) | null
}
export type VoiceSignal = VoiceIdentity & (
  | { kind: 'answer'; sdp: string }
  | { kind: 'state'; state: VoicePhase }
  | { kind: 'closed'; reason?: string }
  | { kind: 'error'; error: string }
)
export type VoiceCommand = VoiceSession & { requestId: string } & (
  | { type: 'voice_status' }
  | { type: 'voice_start'; attemptId: string; request: RealtimeVoiceStartRequest }
  | { type: 'voice_stop'; attemptId: string }
  | { type: 'voice_ready'; attemptId: string; identity: VoiceIdentity }
)

export function isVoiceCommand(command: { type: string }): command is VoiceCommand {
  return ['voice_status', 'voice_start', 'voice_stop', 'voice_ready'].includes(command.type)
}

export function containsVoiceCommand(command: { type: string; command?: { type: string } }): boolean {
  return isVoiceCommand(command) || (command.type === 'environment_command' && !!command.command && isVoiceCommand(command.command))
}

export function isVoiceSignalingEvent(event: { type: string }): boolean {
  return event.type === 'realtime_sdp' || event.type === 'realtime_call_signal'
}

export function validateVoiceAttempt(attemptId: unknown): asserts attemptId is string {
  if (typeof attemptId !== 'string' || !/^[\w-]{1,128}$/.test(attemptId)) throw new Error('Invalid voice attempt')
}

export function validateVoiceStart(request: RealtimeVoiceStartRequest): void {
  if (!request || typeof request.sdp !== 'string' || !/^v=0\r?\n/.test(request.sdp) || request.sdp.length > MAX_VOICE_SDP_CHARS) {
    throw new Error('Invalid voice offer')
  }
  if (request.voice !== undefined && (typeof request.voice !== 'string' || request.voice.length > 128)) throw new Error('Invalid voice selection')
  if (request.additionalDirs !== undefined && (!Array.isArray(request.additionalDirs) || request.additionalDirs.length > 64
    || request.additionalDirs.some(dir => typeof dir !== 'string' || dir.length > 4096 || dir.includes('\0')))) throw new Error('Invalid voice directories')
  const selection = request.selection
  if (selection !== undefined && (!selection || typeof selection !== 'object' || Array.isArray(selection)
    || (selection.model !== undefined && (typeof selection.model !== 'string' || !selection.model.trim() || selection.model.length > 256))
    || (selection.reasoningEffort !== undefined && !['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(selection.reasoningEffort))
    || [selection.serviceTier, selection.apiProviderId].some(value => value !== undefined && value !== null && (typeof value !== 'string' || value.length > 256)))) throw new Error('Invalid voice thread selection')
}

export function assertVoiceAccount(current: string | null | undefined, expected?: string | null): void {
  if (current && !isCodexAccountProvider(current)) throw new Error('Voice requires an official Codex account.')
  if (expected !== undefined && expected !== (current ?? null)) throw new Error('Reopen this conversation to use its Codex account, or start a new conversation for the selected account.')
}

export function sameVoice(a: VoiceIdentity, b: VoiceIdentity): boolean {
  return a.callId === b.callId && a.hostEpoch === b.hostEpoch && a.generation === b.generation && a.attemptId === b.attemptId
}

/** Errors may echo a raw or JSON-escaped offer. Never return that payload to diagnostics. */
export function redactVoiceText(value: string): string {
  return /(?:\bv=0(?:\r?\n|\\r|\\n)|\b(?:sdp|ice-ufrag|ice-pwd|fingerprint)\s*["':=]|(?:^|\n)(?:o=-|s=-|c=IN |m=(?:audio|video) |a=(?:candidate:|ice-|fingerprint:|rtpmap:|fmtp:|setup:)))/i.test(value)
    ? 'Voice signaling detail redacted.' : value
}

export function redactVoiceTraceValue(key: string, value: unknown): unknown {
  if (/sdp|sessiondescription/i.test(key)) return '[REDACTED]'
  return typeof value === 'string' ? redactVoiceText(value) : value
}
