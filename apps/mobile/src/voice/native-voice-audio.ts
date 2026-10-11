import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core'

type VoiceAudioEvents = { onInterruption(event: { owner: string; reason: 'interrupted' }): void; onBufferError(event: { owner: string; message: string }): void }
type VoiceAudio = {
  addListener<K extends keyof VoiceAudioEvents>(event: K, listener: VoiceAudioEvents[K]): EventSubscription
  start(owner: string): Promise<void>; pause(owner: string): Promise<void>; resume(owner: string): Promise<void>; stop(owner: string): Promise<void>
}
export const nativeVoiceAudio = (): VoiceAudio | null => requireOptionalNativeModule<VoiceAudio>('SuperOneVoiceAudio')
export type VoiceAudioSubscription = EventSubscription
