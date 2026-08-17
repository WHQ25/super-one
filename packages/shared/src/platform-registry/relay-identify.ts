import type { CapabilityTask, DiscoveredExtraProtocol, RelayFingerprint, RelayKind } from '../agent-types'
import { FAMILY_TASKS, type ProtocolFamily } from './protocols'

const NEWAPI_VIDEO_RE = /seedance|kling|jimeng|wanx|wan2|vidu|hailuo|dreamina/
const SORA_RE = /\bsora\b/
const CLAUDE_RE = /^(claude|anthropic)[-._]/
const GEMINI_CHAT_RE = /^(gemini|gemma)[-._]/
const VEO_RE = /^veo[-._]/
const GOOGLE_IMAGE_RE = /nano[-._]?banana|^imagen[-._]|^(gemini[-._].*[-._]image(?:[-._]|$))/
const OPENAI_IMAGE_RE =
  /^(dall-e|dalle|gpt[-._]?image)[-._]|^(flux|midjourney|ideogram|recraft|seedream|kolors)[-._]|stable[-._]?diff|[-._]sdxl|sd3[-._]|playground[-._]/
const TTS_RE = /(^tts[-._]|\btts\b|speech[-._]|tts-1)/
const ASR_RE = /(whisper|transcri)/

const NEWAPI_STATUS_KEYS = [
  'quota_display_type',
  'HeaderNavModules',
  'enable_task',
  'self_use_mode_enabled',
  'custom_currency_symbol',
] as const

const SUB2_SETTINGS_KEYS = ['custom_endpoints', 'compact_home_enabled', 'hide_ccs_import_button', 'api_base_url'] as const

/** Relays that speak `/v1/responses` — Codex's native wire. */
export const RELAY_KINDS_WITH_RESPONSES: readonly RelayKind[] = ['new-api', 'one-api', 'sub2api']

function addTask(
  byFamily: Partial<Record<ProtocolFamily, CapabilityTask[]>>,
  family: ProtocolFamily,
  task: CapabilityTask,
): void {
  const tasks = byFamily[family] ?? []
  if (!tasks.includes(task)) tasks.push(task)
  byFamily[family] = tasks
}

/** Bare model id with any `vendor/` namespace prefix stripped. */
export function normalizeRelayModelId(id: string): string {
  const slash = id.lastIndexOf('/')
  return (slash >= 0 ? id.slice(slash + 1) : id).toLowerCase()
}

/** New API's own `/video/generations` vendors (not Sora's `/videos` shape). */
export function isNewApiVideoId(id: string): boolean {
  return NEWAPI_VIDEO_RE.test(normalizeRelayModelId(id))
}

/**
 * Guess protocol family + tasks from a model id when the gateway doesn't send
 * `supported_endpoint_types` (One API, Sub2API, plain `/v1/models`).
 * Returns `{}` when the id is not distinctive — caller should fall back to catalog / openai-chat.
 */
export function classifyModelById(id: string): Partial<Record<ProtocolFamily, CapabilityTask[]>> {
  const bare = normalizeRelayModelId(id)
  const byFamily: Partial<Record<ProtocolFamily, CapabilityTask[]>> = {}
  if (CLAUDE_RE.test(bare)) addTask(byFamily, 'anthropic', 'chat')
  if (VEO_RE.test(bare)) addTask(byFamily, 'google', 'video')
  if (GOOGLE_IMAGE_RE.test(bare)) addTask(byFamily, 'google', 'image')
  else if (GEMINI_CHAT_RE.test(bare)) addTask(byFamily, 'google', 'chat')
  if (SORA_RE.test(bare)) addTask(byFamily, 'openai', 'video')
  if (isNewApiVideoId(bare)) addTask(byFamily, 'newapi', 'video')
  if (OPENAI_IMAGE_RE.test(bare) && !byFamily.google) addTask(byFamily, 'openai', 'image')
  if (TTS_RE.test(bare)) addTask(byFamily, 'openai', 'tts')
  if (ASR_RE.test(bare)) addTask(byFamily, 'openai', 'asr')
  return byFamily
}

/** True when the id itself is a media model (image/video/tts/asr), not a chat alias. */
export function idImpliesSpecializedMedia(id: string): boolean {
  return Object.values(classifyModelById(id)).some((tasks) => tasks.some((t) => t !== 'chat'))
}

/**
 * Overlay id-based media tasks. If the id is a dedicated image/video/tts/asr model, drop a
 * chat task that only came from a generic `gemini`/`openai` endpoint type or owned_by hint.
 */
export function mergeSpecializedIdHints(
  byFamily: Partial<Record<ProtocolFamily, CapabilityTask[]>>,
  id: string,
): Partial<Record<ProtocolFamily, CapabilityTask[]>> {
  const hint = classifyModelById(id)
  if (!Object.values(hint).some((tasks) => tasks.some((t) => t !== 'chat'))) return byFamily
  const next: Partial<Record<ProtocolFamily, CapabilityTask[]>> = {}
  for (const [family, tasks] of Object.entries(byFamily) as [ProtocolFamily, CapabilityTask[]][]) {
    const kept = tasks.filter((t) => t !== 'chat')
    if (kept.length > 0) next[family] = [...kept]
  }
  for (const [family, tasks] of Object.entries(hint) as [ProtocolFamily, CapabilityTask[]][]) {
    for (const task of tasks) addTask(next, family, task)
  }
  return next
}

/**
 * Move Seedance/Kling/… video off the Sora-shaped openai-video wire onto newapi-video.
 * New API reports those as `openai-video` even though they speak `/video/generations`.
 */
export function reclassifyVideoFamily(
  byFamily: Partial<Record<ProtocolFamily, CapabilityTask[]>>,
  id: string,
): Partial<Record<ProtocolFamily, CapabilityTask[]>> {
  if (!isNewApiVideoId(id)) return byFamily
  const next: Partial<Record<ProtocolFamily, CapabilityTask[]>> = { ...byFamily }
  const openaiTasks = next.openai
  if (openaiTasks?.includes('video')) {
    const rest = openaiTasks.filter((t) => t !== 'video')
    if (rest.length > 0) next.openai = rest
    else delete next.openai
  }
  addTask(next, 'newapi', 'video')
  return next
}

function homeForTask(
  task: CapabilityTask,
  heuristic: Partial<Record<ProtocolFamily, CapabilityTask[]>>,
  ownerFamily?: ProtocolFamily,
): ProtocolFamily {
  const hinted = (Object.keys(heuristic) as ProtocolFamily[]).find((f) => FAMILY_TASKS[f]?.includes(task))
  if (hinted) return hinted
  if (ownerFamily && FAMILY_TASKS[ownerFamily]?.includes(task)) return ownerFamily
  return 'openai'
}

/** Heuristic classification, else catalog tasks, else owner/openai chat. */
export function fallbackByFamily(
  id: string,
  catalogTasks?: CapabilityTask[],
  ownerFamily?: ProtocolFamily,
): Partial<Record<ProtocolFamily, CapabilityTask[]>> {
  const heuristic = classifyModelById(id)
  const byFamily: Partial<Record<ProtocolFamily, CapabilityTask[]>> = {}
  for (const [family, tasks] of Object.entries(heuristic) as [ProtocolFamily, CapabilityTask[]][]) {
    for (const task of tasks) addTask(byFamily, family, task)
  }
  const specialized = idImpliesSpecializedMedia(id)
  if (catalogTasks && catalogTasks.length > 0) {
    for (const task of catalogTasks) {
      if (task === 'chat' && specialized) continue
      addTask(byFamily, homeForTask(task, heuristic, ownerFamily), task)
    }
  }
  if (Object.keys(byFamily).length === 0) addTask(byFamily, ownerFamily ?? 'openai', 'chat')
  return reclassifyVideoFamily(byFamily, id)
}

/**
 * New API `/v1/models` `owned_by` and `/api/pricing` `owner_by` name the upstream channel.
 * Relays often rename the model id; this is the extra hint that still identifies the wire.
 */
export function familyFromOwner(owner: string | undefined): ProtocolFamily | undefined {
  if (!owner) return undefined
  const s = owner.toLowerCase()
  if (/anthropic|claude/.test(s)) return 'anthropic'
  if (/gemini|google|vertex/.test(s)) return 'google'
  if (/openai|azure|\bgpt\b/.test(s)) return 'openai'
  return undefined
}

/** New API pricing `tags` (comma/space/`/`/`|` separated) and similar free-text extras. */
export function tasksFromTags(tags: string | undefined): CapabilityTask[] {
  if (!tags) return []
  const blob = tags.toLowerCase()
  const tasks: CapabilityTask[] = []
  const add = (task: CapabilityTask): void => {
    if (!tasks.includes(task)) tasks.push(task)
  }
  if (/video|视频|sora|seedance|kling|可灵/.test(blob)) add('video')
  if (/image|图像|生图|dall|imagen|midjourney|banana|flux/.test(blob)) add('image')
  if (/\btts\b|speech|语音合成/.test(blob)) add('tts')
  if (/whisper|transcri|asr|语音识别/.test(blob)) add('asr')
  return tasks
}

/** New API catalog extras: `input_modalities` / `output_modalities` (`text|image|audio|video|file`). */
export function tasksFromModalities(input: unknown, output: unknown): CapabilityTask[] {
  const inp = new Set(asStringList(input))
  const out = new Set(asStringList(output))
  const tasks: CapabilityTask[] = []
  const add = (task: CapabilityTask): void => {
    if (!tasks.includes(task)) tasks.push(task)
  }
  if (out.has('image')) add('image')
  if (out.has('video')) add('video')
  if (out.has('text') && inp.has('text') && !out.has('image') && !out.has('video')) add('chat')
  if (out.has('audio')) add('tts')
  if (inp.has('audio') && out.has('text')) add('asr')
  return tasks
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string').map((v) => v.toLowerCase())
}

export interface NewApiModelHints {
  endpointTypes?: unknown
  ownedBy?: string
  tags?: string
  inputModalities?: unknown
  outputModalities?: unknown
  catalogTasks?: CapabilityTask[]
}

export function extrasFromEndpointTypes(endpointTypes: unknown): DiscoveredExtraProtocol[] {
  if (!Array.isArray(endpointTypes)) return []
  const extras: DiscoveredExtraProtocol[] = []
  for (const et of endpointTypes) {
    if (et === 'openai-response' || et === 'openai-response-compact') {
      extras.push('openai-responses')
      break
    }
  }
  return extras
}

/** Walk NewAPI-style `{ data: [{ supported_endpoint_types }] }` payloads. */
export function extrasFromRelayData(json: unknown): DiscoveredExtraProtocol[] {
  if (!json || typeof json !== 'object') return []
  const data = (json as Record<string, unknown>).data
  if (!Array.isArray(data)) return []
  const extras: DiscoveredExtraProtocol[] = []
  for (const entry of data) {
    if (!entry || typeof entry !== 'object') continue
    for (const extra of extrasFromEndpointTypes((entry as Record<string, unknown>).supported_endpoint_types)) {
      if (!extras.includes(extra)) extras.push(extra)
    }
  }
  return extras
}

export function mergeDiscoveredExtras(
  ...lists: Array<readonly DiscoveredExtraProtocol[] | undefined>
): DiscoveredExtraProtocol[] {
  const out: DiscoveredExtraProtocol[] = []
  for (const list of lists) {
    for (const extra of list ?? []) {
      if (!out.includes(extra)) out.push(extra)
    }
  }
  return out
}

export function extrasForRelayKind(kind: RelayKind): DiscoveredExtraProtocol[] {
  return RELAY_KINDS_WITH_RESPONSES.includes(kind) ? ['openai-responses'] : []
}

/**
 * Strip version + common API suffixes users paste (`/v1`, `/v1/chat/completions`, `/anthropic`).
 * Inverse of `familyBaseUrl`.
 */
export function relaySiteRoot(baseUrl: string): string {
  let raw = baseUrl.trim()
  try {
    const parsed = new URL(raw)
    raw = `${parsed.origin}${parsed.pathname}`
  } catch {
    // keep as-is — callers may pass a host-less path in tests
  }
  let u = raw.replace(/\/+$/, '')
  u = u.replace(
    /\/(?:v1beta|v1alpha|v\d+)(?:\/(?:chat\/completions|completions|messages|models|responses|images(?:\/(?:generations|edits))?|videos(?:\/generations)?))?$/i,
    '',
  )
  u = u.replace(/\/anthropic$/i, '')
  return u
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function stringField(row: Record<string, unknown>, key: string): string | undefined {
  const v = row[key]
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

/**
 * New API / One API public `GET {site}/api/status` envelope.
 * New API adds panel fields (`enable_task`, `quota_display_type`, …) One API does not.
 */
export function parseNewApiStatus(json: unknown): RelayFingerprint | null {
  const root = asRecord(json)
  if (!root) return null
  const data = asRecord(root.data)
  if (!data) return null
  const version = stringField(data, 'version')
  const name = stringField(data, 'system_name')
  if (!version && !name) return null

  const nameL = (name ?? '').toLowerCase()
  const hasNewApiField = NEWAPI_STATUS_KEYS.some((k) => k in data)
  if (hasNewApiField || /new[\s-]?api/.test(nameL)) return { kind: 'new-api', name }
  if (/one[\s-]?api/.test(nameL)) return { kind: 'one-api', name }
  if ('start_time' in data) return { kind: 'one-api', name }
  return { kind: 'one-api', name }
}

/** Sub2API public `GET {site}/api/v1/settings/public`. */
export function parseSub2ApiPublicSettings(json: unknown): RelayFingerprint | null {
  const row = asRecord(json)
  if (!row) return null
  const name = stringField(row, 'site_name')
  if (!name) return null
  if (!SUB2_SETTINGS_KEYS.some((k) => k in row)) return null
  return { kind: 'sub2api', name }
}

export function inferRelayKind(input: {
  status: RelayFingerprint | null
  sub2: RelayFingerprint | null
  pricingHasEndpointTypes: boolean
  pricingOk: boolean
  modelsListOk: boolean
}): RelayFingerprint {
  if (input.sub2) return input.sub2
  if (input.status) return input.status
  if (input.pricingHasEndpointTypes) return { kind: 'new-api' }
  if (input.pricingOk) return { kind: 'one-api' }
  if (input.modelsListOk) return { kind: 'openai-compatible' }
  return { kind: 'openai-compatible' }
}

export function pricingHasEndpointTypes(json: unknown): boolean {
  if (!json || typeof json !== 'object') return false
  const data = (json as Record<string, unknown>).data
  if (!Array.isArray(data)) return false
  return data.some((entry) => {
    if (!entry || typeof entry !== 'object') return false
    const types = (entry as Record<string, unknown>).supported_endpoint_types
    return Array.isArray(types) && types.length > 0
  })
}
