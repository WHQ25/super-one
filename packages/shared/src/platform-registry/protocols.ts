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
  | 'openai-video' // video (/videos submit + poll + /content — Sora and relays that copy its shape)
  | 'newapi-video' // video (/video/generations submit + poll + /videos/{id}/content — New API's own generic multi-vendor task relay, distinct from the Sora-shaped /videos wire; fans out to Doubao/Kling/etc. by model id)
  | 'google-generative' // chat, image, tts (generateContent)
  | 'google-video' // video (Veo via predictLongRunning + operations poll; same key/base as generateContent)
  | 'ark-images' // image (/images/generations only — reference images ride a JSON `image` field, no /edits)
  | 'ark-video' // video (/contents/generations/tasks submit + poll; settings ride as top-level JSON fields)

export const WIRE_PROTOCOLS: WireProtocol[] = [
  'anthropic-messages',
  'openai-chat',
  'openai-responses',
  'openai-images',
  'openai-audio',
  'openai-video',
  'newapi-video',
  'google-generative',
  'google-video',
  'ark-images',
  'ark-video',
]

/** Capabilities each protocol can serve. An endpoint may narrow this set, never widen it. */
export const PROTOCOL_TASKS: Record<WireProtocol, CapabilityTask[]> = {
  'anthropic-messages': ['chat'],
  'openai-chat': ['chat'],
  'openai-responses': ['chat', 'image'],
  'openai-images': ['image'],
  'openai-audio': ['tts', 'asr'],
  'openai-video': ['video'],
  'newapi-video': ['video'],
  'google-generative': ['chat', 'image', 'tts'],
  'google-video': ['video'],
  'ark-images': ['image'],
  'ark-video': ['video'],
}

export function protocolServes(protocol: WireProtocol, task: CapabilityTask): boolean {
  return PROTOCOL_TASKS[protocol].includes(task)
}

/**
 * Vendor family a protocol belongs to. Derived UI grouping only — never a source of truth.
 * `newapi` is not a real AI vendor — it groups New API/one-api-style relays' own proprietary
 * multi-vendor video wire (`newapi-video`), which is neither OpenAI's nor any single upstream
 * vendor's actual protocol shape (unlike `openai-video`, which genuinely is Sora's `/videos`
 * shape copied by relays). It gets its own family instead of hiding inside `openai` so the
 * custom-platform dialog doesn't label a non-OpenAI wire "OpenAI".
 */
export type ProtocolFamily = 'anthropic' | 'openai' | 'newapi' | 'google'

export const PROTOCOL_FAMILIES: ProtocolFamily[] = ['anthropic', 'openai', 'newapi', 'google']

export const PROTOCOL_FAMILY: Record<WireProtocol, ProtocolFamily> = {
  'anthropic-messages': 'anthropic',
  'openai-chat': 'openai',
  'openai-responses': 'openai',
  'openai-images': 'openai',
  'openai-audio': 'openai',
  'openai-video': 'openai',
  'newapi-video': 'newapi',
  'google-generative': 'google',
  'google-video': 'google',
  'ark-images': 'openai',
  'ark-video': 'openai',
}

/**
 * Protocols a family offers in the custom-platform dialog.
 * Order is behavioral: selectEndpoint() returns the first endpoint serving a task,
 * so responses precedes chat (codex's native wire is Responses; chat/completions is being deprecated upstream).
 * Vendor-private protocols (ark-images, ark-video) are deliberately absent — they are only reachable
 * from the builtin platform that speaks them, never offered to an arbitrary custom platform of the
 * same family.
 */
export const FAMILY_PROTOCOLS: Record<ProtocolFamily, WireProtocol[]> = {
  anthropic: ['anthropic-messages'],
  openai: [
    'openai-responses',
    'openai-chat',
    'openai-images',
    'openai-audio',
    'openai-video',
  ],
  newapi: ['newapi-video'],
  google: [
    'google-generative',
    'google-video'
  ],
}

/** Protocol priority within an endpoint / plan (flattened family order). selectEndpoint() takes the first match. */
export const PROTOCOL_ORDER: WireProtocol[] = PROTOCOL_FAMILIES.flatMap((f) => FAMILY_PROTOCOLS[f])

export const CAPABILITY_ORDER: CapabilityTask[] = ['chat', 'image', 'video', 'tts', 'asr']

/**
 * The wire protocol that serves each capability within a family — the mapping behind the
 * capability-driven custom-platform dialog. A user picks a compat family + the capabilities their
 * endpoint exposes; we derive the endpoints.
 * openai chat → chat/completions (what "OpenAI-compatible" relays actually implement; the Responses
 * wire is offered separately via FAMILY_EXTRA_PROTOCOLS). tts+asr share one audio endpoint; video is
 * Sora's `/videos` shape, which relays copy (see ENDPOINT_TYPE_MAP's `openai-video`); gemini serves
 * chat/image/tts via generateContent but Veo rides its own predictLongRunning wire, so video is a
 * separate protocol rather than a task added to google-generative — keeping the two off one protocol
 * means a curated Veo model list can live on its own endpoint without replacing the catalog-driven
 * model list of the generateContent endpoint (resolveEndpointModels treats `models` as a full replace).
 */
export const FAMILY_TASK_PROTOCOL: Record<ProtocolFamily, Partial<Record<CapabilityTask, WireProtocol>>> = {
  anthropic: { chat: 'anthropic-messages' },
  openai: {
    chat: 'openai-chat',
    image: 'openai-images',
    video: 'openai-video',
    tts: 'openai-audio',
    asr: 'openai-audio',
  },
  newapi: { video: 'newapi-video' },
  google: {
    chat: 'google-generative',
    image: 'google-generative',
    video: 'google-video',
    tts: 'google-generative',
  },
}

/** Capabilities a family can expose, in canonical order. Derived from FAMILY_TASK_PROTOCOL. */
export const FAMILY_TASKS: Record<ProtocolFamily, CapabilityTask[]> = {
  anthropic: CAPABILITY_ORDER.filter((task) => FAMILY_TASK_PROTOCOL.anthropic[task]),
  openai: CAPABILITY_ORDER.filter((task) => FAMILY_TASK_PROTOCOL.openai[task]),
  newapi: CAPABILITY_ORDER.filter((task) => FAMILY_TASK_PROTOCOL.newapi[task]),
  google: CAPABILITY_ORDER.filter((task) => FAMILY_TASK_PROTOCOL.google[task]),
}

/**
 * Opt-in wire protocols a family exposes as separate toggles beyond its capability tasks — a second wire
 * for a task already served by another protocol. OpenAI's Responses wire serves the same chat task as
 * chat/completions and is codex's native wire; codex also accepts openai-chat through the built-in proxy.
 */
export const FAMILY_EXTRA_PROTOCOLS: Record<ProtocolFamily, WireProtocol[]> = {
  anthropic: [],
  openai: ['openai-responses'],
  newapi: [],
  google: [],
}

export function familyBaseUrl(family: ProtocolFamily, baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '')
  if (!trimmed || /\/v\d+(?:alpha|beta)?$/.test(trimmed)) return trimmed
  if (family === 'google') return `${trimmed}/v1beta`
  if (family === 'openai' || family === 'newapi') return `${trimmed}/v1`
  return trimmed
}

/**
 * Build the endpoint for a custom platform from a compat family + the capabilities it exposes (plus any
 * opt-in extra wires like OpenAI's Responses). One family = one addressable service = **one endpoint**
 * (id = the family name), holding every protocol needed to serve the picked capabilities (e.g. openai
 * chat+image → one endpoint speaking `openai-chat` + `openai-images`). Capability narrowing is not stored
 * on the endpoint — it happens downstream via the enabled models' `tasks` tags. The base URL is derived
 * per family via familyBaseUrl so one relay root fans out to the right sub-path per protocol. Returns `[]`
 * when nothing is picked.
 */
export function customEndpointsFor(
  family: ProtocolFamily,
  tasks: CapabilityTask[],
  baseUrl: string,
  extraProtocols: WireProtocol[] = [],
): ServiceEndpoint[] {
  const protocols: WireProtocol[] = []
  for (const task of CAPABILITY_ORDER) {
    if (!tasks.includes(task)) continue
    const protocol = FAMILY_TASK_PROTOCOL[family][task]
    if (protocol && !protocols.includes(protocol)) protocols.push(protocol)
  }
  for (const p of extraProtocols) {
    if (FAMILY_EXTRA_PROTOCOLS[family].includes(p) && !protocols.includes(p)) protocols.push(p)
  }
  if (protocols.length === 0) return []
  protocols.sort((a, b) => PROTOCOL_ORDER.indexOf(a) - PROTOCOL_ORDER.indexOf(b))
  return [{ id: family, baseUrl: familyBaseUrl(family, baseUrl), protocols }]
}

/**
 * Build all endpoints for a custom platform that speaks several compat families over one shared base URL
 * (e.g. a relay exposing both Claude and OpenAI formats). Each family carries its OWN picked capabilities
 * (and optional extra wires) and becomes one endpoint keyed by the family name; families are emitted in
 * canonical order regardless of map order. Endpoint ids are unique by construction (one per family).
 */
export function customPlatformEndpoints(
  tasksByFamily: Partial<Record<ProtocolFamily, CapabilityTask[]>>,
  baseUrl: string,
  extraByFamily: Partial<Record<ProtocolFamily, WireProtocol[]>> = {},
): ServiceEndpoint[] {
  const out: ServiceEndpoint[] = []
  for (const family of PROTOCOL_FAMILIES) {
    const tasks = tasksByFamily[family] ?? []
    const extra = extraByFamily[family] ?? []
    if (tasks.length === 0 && extra.length === 0) continue
    out.push(...customEndpointsFor(family, tasks, baseUrl, extra))
  }
  return out
}

/**
 * The protocols a chat harness consumer accepts, in preference order.
 * codex speaks Responses wire natively; openai-chat providers are bridged through the
 * built-in Responses→Chat proxy (see llm-proxy-manager ensureCodexProxyUrl).
 */
export const HARNESS_CHAT_PROTOCOLS: Record<'claude' | 'codex', WireProtocol[]> = {
  claude: ['anthropic-messages'],
  codex: ['openai-responses', 'openai-chat'],
}

export const PROXY_TRANSFORMERS_ENV = 'SUPERONE_PROXY_TRANSFORMERS'
