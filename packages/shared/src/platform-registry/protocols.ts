import type { CapabilityTask } from '../agent-types'
import type { ServiceEndpoint } from './types'

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

/** Vendor family a protocol belongs to. Derived UI grouping only — never a source of truth. */
export type ProtocolFamily = 'anthropic' | 'openai' | 'google'

export const PROTOCOL_FAMILIES: ProtocolFamily[] = ['anthropic', 'openai', 'google']

export const PROTOCOL_FAMILY: Record<WireProtocol, ProtocolFamily> = {
  'anthropic-messages': 'anthropic',
  'openai-chat': 'openai',
  'openai-responses': 'openai',
  'openai-images': 'openai',
  'openai-audio': 'openai',
  'google-generative': 'google',
}

/**
 * Protocols a family offers in the custom-platform dialog.
 * Order is behavioral: selectEndpoint() returns the first endpoint serving a task,
 * so responses precedes chat (codex's native wire is Responses; chat/completions is being deprecated upstream).
 */
export const FAMILY_PROTOCOLS: Record<ProtocolFamily, WireProtocol[]> = {
  anthropic: ['anthropic-messages'],
  openai: ['openai-responses', 'openai-chat', 'openai-images', 'openai-audio'],
  google: ['google-generative'],
}

/** Stable, human-readable endpoint id per protocol for generated custom plans. */
export const PROTOCOL_ENDPOINT_ID: Record<WireProtocol, string> = {
  'anthropic-messages': 'messages',
  'openai-chat': 'chat',
  'openai-responses': 'responses',
  'openai-images': 'images',
  'openai-audio': 'audio',
  'google-generative': 'generative',
}

/** Endpoint priority within a plan (flattened family order). selectEndpoint() takes the first match. */
export const PROTOCOL_ORDER: WireProtocol[] = PROTOCOL_FAMILIES.flatMap((f) => FAMILY_PROTOCOLS[f])

export const CAPABILITY_ORDER: CapabilityTask[] = ['chat', 'image', 'video', 'tts', 'asr']

/**
 * The wire protocol that serves each capability within a family — the mapping behind the
 * capability-driven custom-platform dialog. A user picks a compat family + the capabilities their
 * endpoint exposes; we derive the endpoints. Tasks absent here (e.g. video) have no wire protocol yet.
 * openai chat → chat/completions (what "OpenAI-compatible" relays actually implement; responses stays
 * for the official builtin platform). tts+asr share one audio endpoint; gemini serves all via generateContent.
 */
export const FAMILY_TASK_PROTOCOL: Record<ProtocolFamily, Partial<Record<CapabilityTask, WireProtocol>>> = {
  anthropic: { chat: 'anthropic-messages' },
  openai: { chat: 'openai-chat', image: 'openai-images', tts: 'openai-audio', asr: 'openai-audio' },
  google: { chat: 'google-generative', image: 'google-generative', tts: 'google-generative' },
}

/** Capabilities a family can expose, in canonical order. Derived from FAMILY_TASK_PROTOCOL. */
export const FAMILY_TASKS: Record<ProtocolFamily, CapabilityTask[]> = {
  anthropic: CAPABILITY_ORDER.filter((task) => FAMILY_TASK_PROTOCOL.anthropic[task]),
  openai: CAPABILITY_ORDER.filter((task) => FAMILY_TASK_PROTOCOL.openai[task]),
  google: CAPABILITY_ORDER.filter((task) => FAMILY_TASK_PROTOCOL.google[task]),
}

/**
 * Build the endpoints for a custom platform from a compat family + the capabilities it exposes,
 * all sharing one base URL. Capabilities served by the same protocol collapse into one endpoint
 * (e.g. gemini chat+image+tts → a single generative endpoint), whose `tasks` narrows to the picked set.
 */
export function customEndpointsFor(
  family: ProtocolFamily,
  tasks: CapabilityTask[],
  baseUrl: string,
): ServiceEndpoint[] {
  const byProtocol = new Map<WireProtocol, CapabilityTask[]>()
  for (const task of CAPABILITY_ORDER) {
    if (!tasks.includes(task)) continue
    const protocol = FAMILY_TASK_PROTOCOL[family][task]
    if (!protocol) continue
    const existing = byProtocol.get(protocol)
    if (existing) existing.push(task)
    else byProtocol.set(protocol, [task])
  }
  return [...byProtocol.entries()]
    .sort(([a], [b]) => PROTOCOL_ORDER.indexOf(a) - PROTOCOL_ORDER.indexOf(b))
    .map(([protocol, picked]) => {
      const endpoint: ServiceEndpoint = { id: PROTOCOL_ENDPOINT_ID[protocol], protocol, baseUrl }
      if (picked.length < PROTOCOL_TASKS[protocol].length) endpoint.tasks = picked
      return endpoint
    })
}

/**
 * Build all endpoints for a custom platform that speaks several compat families over one shared base URL
 * (e.g. a relay exposing both Claude and OpenAI formats). Each family carries its OWN picked capabilities,
 * so a format can expose a different capability set than its siblings. Endpoint ids stay unique across
 * families (suffixed on the rare clash); families are emitted in canonical order regardless of map order.
 */
export function customPlatformEndpoints(
  tasksByFamily: Partial<Record<ProtocolFamily, CapabilityTask[]>>,
  baseUrl: string,
): ServiceEndpoint[] {
  const used = new Set<string>()
  const out: ServiceEndpoint[] = []
  for (const family of PROTOCOL_FAMILIES) {
    const tasks = tasksByFamily[family]
    if (!tasks || tasks.length === 0) continue
    for (const endpoint of customEndpointsFor(family, tasks, baseUrl)) {
      let id = endpoint.id
      let n = 2
      while (used.has(id)) id = `${endpoint.id}-${n++}`
      used.add(id)
      out.push({ ...endpoint, id })
    }
  }
  return out
}

/** The protocols a chat harness consumer accepts. */
export const HARNESS_CHAT_PROTOCOLS: Record<'claude' | 'codex', WireProtocol[]> = {
  claude: ['anthropic-messages'],
  codex: ['openai-responses', 'openai-chat'],
}
