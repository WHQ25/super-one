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
  | 'ark-images' // image (/images/generations only — reference images ride a JSON `image` field, no /edits)
  // video (/contents/generations/tasks submit + poll — Volcengine Ark's own Seedance wire; settings
  // ride as top-level JSON fields). Direct-to-Ark only: New API-style relays run Seedance through
  // their own `DoubaoVideo` *upstream channel* but expose only `newapi-video` to clients, so a relay
  // base URL on this protocol 404s. The relay's channel name is not this protocol.
  | 'ark-video'
  | 'newapi-video' // video (/video/generations submit + poll + /videos/{id}/content — New API's own generic multi-vendor task relay, distinct from the Sora-shaped /videos wire; fans out to Doubao/Kling/etc. by model id)
  | 'google-generative' // chat, image, tts (generateContent)
  | 'google-video' // video (Veo via predictLongRunning + operations poll; same key/base as generateContent)

/** Capabilities each protocol can serve. An endpoint may narrow this set, never widen it. */
export const PROTOCOL_TASKS: Record<WireProtocol, CapabilityTask[]> = {
  'anthropic-messages': ['chat'],
  'openai-chat': ['chat'],
  'openai-responses': ['chat', 'image'],
  'openai-images': ['image'],
  'openai-audio': ['tts', 'asr'],
  'openai-video': ['video'],
  'ark-images': ['image'],
  'ark-video': ['video'],
  'newapi-video': ['video'],
  'google-generative': ['chat', 'image', 'tts'],
  'google-video': ['video'],
}

export function protocolServes(protocol: WireProtocol, task: CapabilityTask): boolean {
  return PROTOCOL_TASKS[protocol].includes(task)
}

/**
 * Who defined a protocol — the vendor whose API shape it is, not who happens to relay it.
 *
 * This is a real property of the wire, not a UI convenience: a family's protocols share a base path
 * (`/v1`, `/v1beta`, `/api/v3`) and are reached from one root with one key, which is exactly what
 * makes them groupable in the picker AND collapsible into one endpoint. Ark's image and video wires
 * are Volcengine's own shape, so they are a family of their own rather than filed under `openai`
 * because a relay happens to expose them next to OpenAI's. Same for New API's private video wire.
 */
export type ProtocolFamily = 'anthropic' | 'openai' | 'volcengine' | 'newapi' | 'google'

export const PROTOCOL_FAMILIES: ProtocolFamily[] = ['anthropic', 'openai', 'volcengine', 'newapi', 'google']

/**
 * Protocols each family offers, in selection priority order.
 *
 * Order is behavioral, not cosmetic: `selectProtocol` takes the first protocol serving a task, so
 * responses precedes chat (codex's native wire is Responses; chat/completions is deprecated upstream).
 */
export const FAMILY_PROTOCOLS: Record<ProtocolFamily, WireProtocol[]> = {
  anthropic: ['anthropic-messages'],
  openai: ['openai-responses', 'openai-chat', 'openai-images', 'openai-audio', 'openai-video'],
  volcengine: ['ark-images', 'ark-video'],
  newapi: ['newapi-video'],
  google: ['google-generative', 'google-video'],
}

export const PROTOCOL_FAMILY: Record<WireProtocol, ProtocolFamily> = Object.fromEntries(
  PROTOCOL_FAMILIES.flatMap((family) => FAMILY_PROTOCOLS[family].map((protocol) => [protocol, family])),
) as Record<WireProtocol, ProtocolFamily>

export const WIRE_PROTOCOLS: WireProtocol[] = PROTOCOL_FAMILIES.flatMap((f) => FAMILY_PROTOCOLS[f])

/** Protocol priority within an endpoint / plan. selectProtocol() takes the first match. */
export const PROTOCOL_ORDER: WireProtocol[] = WIRE_PROTOCOLS

export const CAPABILITY_ORDER: CapabilityTask[] = ['chat', 'image', 'video', 'tts', 'asr']

/**
 * Protocols that must be declared explicitly rather than inferred from a capability.
 *
 * A relay reporting "this model does chat" means `openai-chat` — the wire OpenAI-compatible relays
 * actually implement. Responses serves the same task but is codex's native wire and far from
 * universal, so enabling it off a bare `chat` hint would point every discovered relay at an endpoint
 * most of them do not have. It stays opt-in: discovery turns it on only when the gateway names it.
 */
export const OPT_IN_PROTOCOLS: WireProtocol[] = ['openai-responses']

/** Whether a protocol can be inferred from a capability alone. */
export function isInferableProtocol(protocol: WireProtocol): boolean {
  return !OPT_IN_PROTOCOLS.includes(protocol)
}

/** Video wires — the protocols that get an endpoint to themselves. */
export const VIDEO_WIRES = ['openai-video', 'ark-video', 'newapi-video', 'google-video'] as const

export type VideoWire = (typeof VIDEO_WIRES)[number]

export function isVideoWire(protocol: string): protocol is VideoWire {
  return (VIDEO_WIRES as readonly string[]).includes(protocol)
}

/**
 * Where a model's task lands: a video wire (which owns its endpoint) or a family (whose endpoint is
 * shared by every non-video protocol). This is exactly the endpoint-id space, named as a type so
 * discovery can say *which endpoint* a model belongs on rather than only which vendor.
 */
export type EndpointSlot = ProtocolFamily | VideoWire

/** Tasks a slot can serve: `video` alone for a wire slot, the union of the family's non-video protocols otherwise. */
export function slotTasks(slot: EndpointSlot): CapabilityTask[] {
  if (isVideoWire(slot)) return ['video']
  const set = new Set<CapabilityTask>()
  for (const protocol of FAMILY_PROTOCOLS[slot]) {
    if (isVideoWire(protocol)) continue
    for (const task of PROTOCOL_TASKS[protocol]) set.add(task)
  }
  return CAPABILITY_ORDER.filter((t) => set.has(t))
}

/**
 * The wire protocols a slot needs in order to serve the given tasks.
 *
 * A video wire slot IS its protocol. A family slot expands to that family's inferable, non-video
 * protocols that serve at least one of the tasks — which is how a discovered `{openai: ['chat','image']}`
 * becomes `openai-chat` + `openai-images` without a hand-written capability→wire table.
 */
export function protocolsForSlot(slot: EndpointSlot, tasks: CapabilityTask[]): WireProtocol[] {
  if (isVideoWire(slot)) return [slot]
  return FAMILY_PROTOCOLS[slot].filter(
    (p) => !isVideoWire(p) && isInferableProtocol(p) && tasks.some((t) => protocolServes(p, t)),
  )
}

/** The video wire a family defaults to, for classifications that only know the family. */
export function defaultVideoWire(family: ProtocolFamily): VideoWire | undefined {
  return FAMILY_PROTOCOLS[family].find(isVideoWire)
}

/** The slot a (family, task) pair lands in. Non-video tasks stay on their family. */
export function slotForTask(family: ProtocolFamily, task: CapabilityTask): EndpointSlot {
  if (task !== 'video') return family
  return defaultVideoWire(family) ?? family
}

/**
 * Version path each family's base URL carries, appended to the shared site root.
 *
 * Anthropic is empty on purpose: the Claude SDK is handed a bare root and appends `/v1/messages`
 * itself, so the version segment lives in the route rather than the base — see `PROTOCOL_ROUTE`.
 */
export const FAMILY_PATH: Record<ProtocolFamily, string> = {
  anthropic: '',
  openai: '/v1',
  volcengine: '/api/v3',
  newapi: '/v1',
  google: '/v1beta',
}

/**
 * Base URL for a family. Already-versioned roots are left alone so a pasted
 * `https://ark.cn-beijing.volces.com/api/v3` survives verbatim.
 */
export function familyBaseUrl(family: ProtocolFamily, baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '')
  if (!trimmed || /\/(?:api\/)?v\d+(?:alpha|beta)?$/.test(trimmed)) return trimmed
  return `${trimmed}${FAMILY_PATH[family]}`
}

/**
 * The request path each protocol is addressed at, **relative to its endpoint's base URL** — i.e. what
 * the driver (or the vendor SDK) appends. Mirrors real call sites; `{model}` marks a path parameter:
 *
 * - `anthropic-messages` — Claude SDK, base is a bare root
 * - `openai-*` — vendor SDK, except `openai-video` (`video/openai/video-model.ts`)
 * - `ark-images` / `ark-video` — `media-gen/ark/image-model.ts`, `video/ark/video-model.ts`
 * - `newapi-video` — `video/newapi/video-model.ts` (submission path; status rides `/videos/{id}`)
 * - `google-video` — `video/google/video-model.ts`
 *
 * Display only. Keep it in step with those files when a route changes — nothing enforces it, because
 * the paths live inside driver template strings and vendor SDKs.
 */
export const PROTOCOL_ROUTE: Record<WireProtocol, string> = {
  'anthropic-messages': '/v1/messages',
  'openai-chat': '/chat/completions',
  'openai-responses': '/responses',
  'openai-images': '/images/generations',
  'openai-audio': '/audio/speech',
  'openai-video': '/videos',
  'ark-images': '/images/generations',
  'ark-video': '/contents/generations/tasks',
  'newapi-video': '/video/generations',
  'google-generative': '/models/{model}:generateContent',
  'google-video': '/models/{model}:predictLongRunning',
}

/**
 * A protocol's full request path measured from the shared site root — what a user compares against
 * their relay's docs. Derived from FAMILY_PATH + PROTOCOL_ROUTE so it cannot drift from the base URL
 * the resolver actually builds.
 */
export function protocolRoute(protocol: WireProtocol): string {
  return `${FAMILY_PATH[PROTOCOL_FAMILY[protocol]]}${PROTOCOL_ROUTE[protocol]}`
}

/** Comparison form for a route: absolute, lowercase, no query/trailing slash, path params collapsed. */
function normalizeRoutePath(raw: string): string {
  let path = raw.trim()
  try {
    path = new URL(path).pathname
  } catch {
    // relative path — relays publish these as written
  }
  path = path.split(/[?#]/)[0].replace(/\/+$/, '')
  if (path && !path.startsWith('/')) path = `/${path}`
  return path.toLowerCase().replace(/\{[^}]*\}/g, '{}')
}

const ROUTE_PROTOCOL = new Map<string, WireProtocol>(
  WIRE_PROTOCOLS.map((protocol) => [normalizeRoutePath(protocolRoute(protocol)), protocol]),
)

/**
 * Inverse of {@link protocolRoute}: which protocol speaks a given site-root-relative path.
 *
 * This is what lets a relay's *declared routes* outrank its endpoint-type *names*. New API publishes
 * `{ "<type name>": { path, method } }` at `/api/pricing`, and the names are its own vocabulary —
 * its single `openai-video` type is used for both Sora's `/v1/videos` and New API's own
 * `/v1/video/generations`, which are different wires. The path is unambiguous; the name is not.
 *
 * Returns `undefined` for paths we don't implement, so callers fall back to name conventions.
 */
export function protocolForRoute(path: string): WireProtocol | undefined {
  return ROUTE_PROTOCOL.get(normalizeRoutePath(path))
}

/**
 * Endpoint id a protocol contributes to. Video wires get an endpoint of their own (id = the
 * protocol); every other protocol shares its family's single endpoint (id = the family).
 *
 * The video exception is load-bearing, not tidiness: model→endpoint routing needs each video wire's
 * enabled models to be separable, which one shared `models` array cannot express.
 */
export function endpointIdFor(protocol: WireProtocol): EndpointSlot {
  return isVideoWire(protocol) ? protocol : PROTOCOL_FAMILY[protocol]
}

/**
 * Build a custom platform's endpoints from the protocols it speaks.
 *
 * Endpoints are **derived, never authored**: the user ticks wire protocols and the endpoint list
 * follows. Non-video protocols of a family collapse into one endpoint (they share a route prefix and
 * a key, which is what "one addressable service" means); each video wire becomes its own.
 *
 * No URL is stored here. The site root lives on the plan, and anything vendor-specific is a `routes`
 * entry on the endpoint — see `endpointBaseUrl`.
 */
export function customEndpointsFor(protocols: WireProtocol[]): ServiceEndpoint[] {
  const picked = WIRE_PROTOCOLS.filter((p) => protocols.includes(p))
  const endpoints: ServiceEndpoint[] = []
  const byId = new Map<string, ServiceEndpoint>()
  for (const protocol of picked) {
    const id = endpointIdFor(protocol)
    const existing = byId.get(id)
    if (existing) {
      existing.protocols.push(protocol)
      continue
    }
    const endpoint: ServiceEndpoint = { id, protocols: [protocol] }
    byId.set(id, endpoint)
    endpoints.push(endpoint)
  }
  return endpoints
}

/** The path an endpoint answers `protocol` on, measured from the site root. */
export function endpointRoute(endpoint: Pick<ServiceEndpoint, 'routes'>, protocol: WireProtocol): string {
  const stored = endpoint.routes?.[protocol]?.trim()
  return stored ? normalizeRouteShape(stored) : protocolRoute(protocol)
}

/**
 * Put a hand-typed route into the one shape the rest of the module assumes: leading slash, no
 * trailing slash. Without this, `api/v1/messages` concatenates straight onto the host
 * (`https://relayapi/v1/...`) and `/api/v1/messages/` fails the suffix test, silently falling back
 * to the family default and dropping the `/api` the user typed.
 */
function normalizeRouteShape(route: string): string {
  const withSlash = route.startsWith('/') ? route : `/${route}`
  const trimmed = withSlash.replace(/\/+$/, '')
  return trimmed || '/'
}

/**
 * The base URL a driver or vendor SDK is handed for `protocol`: the full request URL minus the
 * segment the driver appends itself.
 *
 * Drivers take a base, relays publish a route, and this is the one place the two meet. The segment
 * to strip is `PROTOCOL_ROUTE[protocol]` — exactly what the driver will re-append — so the default
 * route round-trips to `familyBaseUrl`, and an override like `/api/anthropic/v1/messages` yields
 * `{root}/api/anthropic` for a Claude SDK that appends `/v1/messages` on its own.
 *
 * A route that does not end with that segment cannot be honoured (we would have nothing coherent to
 * hand the SDK), so it falls back to the family default rather than producing a URL that 404s.
 */
export function endpointBaseUrl(
  siteRoot: string,
  endpoint: Pick<ServiceEndpoint, 'baseUrl' | 'routes'>,
  protocol: WireProtocol,
): string {
  const root = (endpoint.baseUrl || siteRoot).replace(/\/+$/, '')
  // An empty root means "whatever the vendor SDK defaults to" (official OpenAI / Gemini / Vertex).
  // Prefixing a route onto nothing would turn that into a relative URL, so leave it empty.
  if (!root) return ''
  const route = endpointRoute(endpoint, protocol)
  const suffix = PROTOCOL_ROUTE[protocol]
  const prefix = route.endsWith(suffix) ? route.slice(0, route.length - suffix.length) : FAMILY_PATH[PROTOCOL_FAMILY[protocol]]
  return `${root}${prefix}`
}

/** Whether a hand-edited route is one `endpointBaseUrl` can honour. */
export function isUsableRoute(route: string, protocol: WireProtocol): boolean {
  return route.startsWith('/') && route.endsWith(PROTOCOL_ROUTE[protocol])
}

/** The protocols a chat harness accepts without experimental adapters. */
export const HARNESS_CHAT_PROTOCOLS: Record<'claude' | 'codex', WireProtocol[]> = {
  claude: ['anthropic-messages'],
  codex: ['openai-responses', 'openai-chat'],
}

export interface HarnessProtocolOptions {
  /** Opt in to the Messages -> Chat Completions proxy for Claude Code. */
  experimentalClaudeOpenAiChatEnabled?: boolean
}

/** Harness-compatible protocols in preference order, including enabled experiments. */
export function harnessChatProtocols(
  harness: 'claude' | 'codex',
  options?: HarnessProtocolOptions,
): WireProtocol[] {
  if (harness === 'claude' && options?.experimentalClaudeOpenAiChatEnabled) {
    return [...HARNESS_CHAT_PROTOCOLS.claude, 'openai-chat']
  }
  return HARNESS_CHAT_PROTOCOLS[harness]
}

export const PROXY_TRANSFORMERS_ENV = 'SUPERONE_PROXY_TRANSFORMERS'
