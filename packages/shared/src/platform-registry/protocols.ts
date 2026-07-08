import type { CapabilityTask } from '../agent-types'

export type { CapabilityTask }

/** Wire API a request is spoken over. Names the protocol only — never the task. */
export type WireProtocol =
  | 'anthropic-messages' // chat
  | 'openai-chat' // chat (/chat/completions)
  | 'openai-responses' // chat, image (image via built-in image_generation tool)
  | 'openai-images' // image (/images/generations|edits)
  | 'openai-audio' // tts, asr (/audio/speech, /audio/transcriptions)
  | 'google-generative' // chat, image, tts (generateContent)

export const WIRE_PROTOCOLS: WireProtocol[] = [
  'anthropic-messages',
  'openai-chat',
  'openai-responses',
  'openai-images',
  'openai-audio',
  'google-generative',
]

/** Capabilities each protocol can serve. An endpoint may narrow this set, never widen it. */
export const PROTOCOL_TASKS: Record<WireProtocol, CapabilityTask[]> = {
  'anthropic-messages': ['chat'],
  'openai-chat': ['chat'],
  'openai-responses': ['chat', 'image'],
  'openai-images': ['image'],
  'openai-audio': ['tts', 'asr'],
  'google-generative': ['chat', 'image', 'tts'],
}

export function protocolServes(protocol: WireProtocol, task: CapabilityTask): boolean {
  return PROTOCOL_TASKS[protocol].includes(task)
}

/** The protocols a chat harness consumer accepts. */
export const HARNESS_CHAT_PROTOCOLS: Record<'claude' | 'codex', WireProtocol[]> = {
  claude: ['anthropic-messages'],
  codex: ['openai-responses', 'openai-chat'],
}
