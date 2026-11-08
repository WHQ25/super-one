import type { SpeechSavedResult, SpeechSpeakClip, SpeechSpeakResult } from '@superone/shared/agent-types'
import { toast } from 'sonner'

export type SpeechPlaybackPhase = 'idle' | 'loading' | 'playing' | 'paused'

export interface SpeechPlaybackSnapshot {
  messageId: string | null
  phase: SpeechPlaybackPhase
}

const IDLE: SpeechPlaybackSnapshot = { messageId: null, phase: 'idle' }

let snapshot: SpeechPlaybackSnapshot = IDLE
const listeners = new Set<() => void>()
const savedIds = new Set<string>()
const savedListeners = new Set<() => void>()
let audio: HTMLAudioElement | null = null
let objectUrl: string | null = null
let audioCtx: AudioContext | null = null
let nextPcmAt = 0
let pcmSources: AudioBufferSourceNode[] = []
let encodedQueue: { url: string }[] = []
let requestSerial = 0
let accepting = false
let activeMessageId: string | null = null

function emit(next: SpeechPlaybackSnapshot) {
  snapshot = next
  for (const listener of listeners) listener()
}

function notifySaved() {
  for (const listener of savedListeners) listener()
}

export function speechPlaybackSnapshot(): SpeechPlaybackSnapshot {
  return snapshot
}

export function subscribeSpeechPlayback(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function messageHasSavedSpeech(messageId: string): boolean {
  return savedIds.has(messageId)
}

export function subscribeSavedSpeech(listener: () => void): () => void {
  savedListeners.add(listener)
  return () => { savedListeners.delete(listener) }
}

export function rememberSavedSpeech(messageId: string): void {
  bindSpeechCacheCleared()
  if (savedIds.has(messageId)) return
  savedIds.add(messageId)
  notifySaved()
}

export function forgetSavedSpeech(messageIds: readonly string[]): void {
  let changed = false
  for (const id of messageIds) {
    if (savedIds.delete(id)) changed = true
  }
  if (changed) notifySaved()
}

let speechCacheClearBound = false
let unsubscribeSpeechCacheCleared: (() => void) | undefined

export function bindSpeechCacheCleared(): void {
  if (speechCacheClearBound || typeof window === 'undefined') return
  const subscribe = window.app?.onSpeechCacheCleared
  if (!subscribe) return
  speechCacheClearBound = true
  unsubscribeSpeechCacheCleared = subscribe((ids) => forgetSavedSpeech(ids))
}

function releaseAudio() {
  if (audio) {
    audio.pause()
    audio.src = ''
    audio = null
  }
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl)
    objectUrl = null
  }
  for (const source of pcmSources) {
    try { source.stop() } catch { /* already ended */ }
  }
  pcmSources = []
  if (audioCtx) {
    void audioCtx.close()
    audioCtx = null
  }
  nextPcmAt = 0
}

function clearEncodedQueue() {
  for (const item of encodedQueue) URL.revokeObjectURL(item.url)
  encodedQueue = []
}

function resetPlayer(cancel: boolean) {
  requestSerial += 1
  accepting = false
  activeMessageId = null
  clearEncodedQueue()
  releaseAudio()
  if (cancel) void window.app.cancelSpeech?.()
}

export function stopSpeaking(): void {
  resetPlayer(true)
  emit(IDLE)
}

/** Test and story isolation. Does not cancel an in-flight request. */
export function resetSpeechPlaybackForTests(): void {
  resetPlayer(false)
  savedIds.clear()
  notifySaved()
  emit(IDLE)
  unsubscribeSpeechCacheCleared?.()
  unsubscribeSpeechCacheCleared = undefined
  speechCacheClearBound = false
}

export function pauseSpeaking(): void {
  if (snapshot.phase !== 'playing' || !snapshot.messageId) return
  audio?.pause()
  void audioCtx?.suspend()
  emit({ messageId: snapshot.messageId, phase: 'paused' })
}

export function resumeSpeaking(): void {
  if (snapshot.phase !== 'paused' || !snapshot.messageId) return
  const messageId = snapshot.messageId
  emit({ messageId, phase: 'playing' })
  if (audio) void audio.play()
  else if (audioCtx) void audioCtx.resume()
  else void playEncoded(requestSerial)
}

function bytesFromBase64(audioBase64: string): Uint8Array {
  const binary = atob(audioBase64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function settle(serial: number) {
  if (serial !== requestSerial || snapshot.phase === 'paused') return
  if (audio || pcmSources.length > 0) return
  if (encodedQueue.length > 0) {
    void playEncoded(serial)
    return
  }
  if (accepting) return
  releaseAudio()
  activeMessageId = null
  emit(IDLE)
}

function enqueueEncoded(bytes: Uint8Array, mediaType: string, serial: number) {
  if (serial !== requestSerial) return
  const copy = new Uint8Array(bytes)
  const url = URL.createObjectURL(new Blob([copy.buffer], { type: mediaType || 'audio/mpeg' }))
  encodedQueue.push({ url })
  if (!audio && snapshot.phase !== 'paused') void playEncoded(serial)
}

function enqueuePcm(bytes: Uint8Array, sampleRate: number, serial: number) {
  if (serial !== requestSerial || typeof AudioContext === 'undefined') return
  const samples = Math.floor(bytes.byteLength / 2)
  if (samples === 0) return
  if (!audioCtx) audioCtx = new AudioContext({ sampleRate })
  const ctx = audioCtx
  const view = new DataView(bytes.buffer, bytes.byteOffset, samples * 2)
  const buffer = ctx.createBuffer(1, samples, sampleRate)
  const channel = buffer.getChannelData(0)
  for (let i = 0; i < samples; i += 1) channel[i] = view.getInt16(i * 2, true) / 32768
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.connect(ctx.destination)
  const start = Math.max(ctx.currentTime + 0.02, nextPcmAt)
  source.start(start)
  nextPcmAt = start + buffer.duration
  pcmSources.push(source)
  source.onended = () => {
    pcmSources = pcmSources.filter((item) => item !== source)
    settle(serial)
  }
  if (snapshot.phase !== 'playing' && snapshot.phase !== 'paused' && activeMessageId) {
    emit({ messageId: activeMessageId, phase: 'playing' })
  }
}

function enqueueClip(clip: SpeechSpeakClip, serial: number) {
  const bytes = bytesFromBase64(clip.audioBase64)
  if (clip.sampleRate != null) enqueuePcm(bytes, clip.sampleRate, serial)
  else enqueueEncoded(bytes, clip.mediaType, serial)
}

async function playEncoded(serial: number) {
  if (serial !== requestSerial || snapshot.phase === 'paused' || audio) return
  const next = encodedQueue.shift()
  if (!next) {
    settle(serial)
    return
  }
  const element = new Audio(next.url)
  audio = element
  objectUrl = next.url
  element.onended = () => {
    if (serial !== requestSerial || audio !== element) return
    URL.revokeObjectURL(next.url)
    if (objectUrl === next.url) objectUrl = null
    audio = null
    void playEncoded(serial)
  }
  try {
    await element.play()
  } catch (error) {
    if (serial !== requestSerial) return
    releaseAudio()
    clearEncodedQueue()
    accepting = false
    activeMessageId = null
    emit(IDLE)
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500)
    window.app.trace?.('speech.play', 'error', { message })
    toast.error(message)
    return
  }
  if (serial !== requestSerial) return
  if (activeMessageId) emit({ messageId: activeMessageId, phase: 'playing' })
}

function begin(messageId: string): number {
  resetPlayer(false)
  activeMessageId = messageId
  accepting = true
  emit({ messageId, phase: 'loading' })
  return requestSerial
}

/** One player for the whole chat, so two replies never talk over each other. */
export async function speakMessage(messageId: string, text: string): Promise<SpeechSpeakResult | undefined> {
  const serial = begin(messageId)
  let received = 0
  const unsubscribe = window.app.onSpeechClip?.((clip) => {
    received += 1
    enqueueClip(clip, serial)
  })
  try {
    const result = await window.app.speakText({ text, messageId })
    if (serial !== requestSerial) return
    if (!result.ok) {
      accepting = false
      if (!result.cancelled) {
        releaseAudio()
        clearEncodedQueue()
        activeMessageId = null
        emit(IDLE)
      }
      return result
    }
    if (received === 0 && result.audioBase64) enqueueClip({ mediaType: result.mediaType, audioBase64: result.audioBase64 }, serial)
    rememberSavedSpeech(messageId)
    accepting = false
    settle(serial)
    if (result.truncated) return result
    return result
  } catch (error) {
    if (serial !== requestSerial) return
    accepting = false
    releaseAudio()
    clearEncodedQueue()
    activeMessageId = null
    emit(IDLE)
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500)
    window.app.trace?.('speech.play', 'error', { message })
    return { ok: false, error: message }
  } finally {
    if (typeof unsubscribe === 'function') unsubscribe()
  }
}

export async function playSavedSpeech(messageId: string): Promise<SpeechSavedResult | undefined> {
  const serial = begin(messageId)
  accepting = false
  try {
    const saved = await window.app.readSavedSpeech(messageId)
    if (serial !== requestSerial) return
    if (!saved.ok) {
      activeMessageId = null
      emit(IDLE)
      return saved
    }
    for (const clip of saved.clips) enqueueClip(clip, serial)
    settle(serial)
    return saved
  } catch (error) {
    if (serial !== requestSerial) return
    activeMessageId = null
    emit(IDLE)
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500)
    return { ok: false, error: message }
  }
}
