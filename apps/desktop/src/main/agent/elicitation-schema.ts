import {
  VIDEO_GEN_PARAMS_FIELD,
  type ElicitationFormField,
  type ElicitationFormFieldType,
  type VideoGenConfirmPayload,
  type VideoGenParams,
  type VideoGenProviderOption,
  type VideoGenReferenceImageRef,
} from '@superone/shared/agent-types'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/**
 * Parse an elicitation requestedSchema into generic form fields.
 * Shared by the Codex backend (mcpServer/elicitation/request notifications) and the
 * Claude backend (Options.onElicitation) — previously Codex-only in codex-turn.ts.
 */
export function parseElicitationSchema(schema: Record<string, unknown> | null): ElicitationFormField[] {
  if (!schema) return []
  const properties = asRecord(schema.properties)
  if (!properties || Object.keys(properties).length === 0) return []
  const required = Array.isArray(schema.required)
    ? schema.required.filter((r): r is string => typeof r === 'string')
    : []
  const fields: ElicitationFormField[] = []
  for (const [name, raw] of Object.entries(properties)) {
    const propRec = asRecord(raw)
    if (!propRec) continue
    const t = readString(propRec.type)
    const label = readString(propRec.title) ?? name
    const description = readString(propRec.description) ?? undefined
    const isRequired = required.includes(name)
    const enumValues = Array.isArray(propRec.enum)
      ? propRec.enum.filter((v): v is string => typeof v === 'string')
      : undefined
    let fieldType: ElicitationFormFieldType | null = null
    let enumOptions: string[] | undefined
    if (enumValues && enumValues.length > 0 && t === 'string') {
      fieldType = 'enum'
      enumOptions = enumValues
    } else if (t === 'boolean') {
      fieldType = 'boolean'
    } else if (t === 'number' || t === 'integer') {
      fieldType = 'number'
    } else if (t === 'string') {
      fieldType = 'string'
    }
    if (!fieldType) continue
    fields.push({
      name,
      type: fieldType,
      label,
      ...(description ? { description } : {}),
      required: isRequired,
      ...(enumOptions ? { enumOptions } : {}),
    })
  }
  return fields
}

function isVideoGenRole(value: unknown): value is VideoGenReferenceImageRef['role'] {
  return value === 'first_frame' || value === 'last_frame' || value === 'reference'
}

function parseVideoGenParams(value: unknown): VideoGenParams | null {
  const rec = asRecord(value)
  if (!rec) return null
  const prompt = readString(rec.prompt)
  const provider = readString(rec.provider)
  const model = readString(rec.model)
  const aspectRatio = readString(rec.aspectRatio)
  const resolution = readString(rec.resolution)
  if (!prompt || !provider || !model || !aspectRatio || !resolution) return null
  if (typeof rec.duration !== 'number' || !Number.isFinite(rec.duration)) return null
  if (typeof rec.generateAudio !== 'boolean' || typeof rec.watermark !== 'boolean' || typeof rec.cameraFixed !== 'boolean') return null
  return {
    prompt,
    provider,
    model,
    aspectRatio,
    resolution,
    duration: rec.duration,
    ...(typeof rec.fps === 'number' && Number.isFinite(rec.fps) ? { fps: rec.fps } : {}),
    ...(typeof rec.seed === 'number' && Number.isFinite(rec.seed) ? { seed: rec.seed } : {}),
    generateAudio: rec.generateAudio,
    watermark: rec.watermark,
    cameraFixed: rec.cameraFixed,
  }
}

function parseProviderOptions(value: unknown): VideoGenProviderOption[] | null {
  if (!Array.isArray(value)) return null
  const out: VideoGenProviderOption[] = []
  for (const entry of value) {
    const rec = asRecord(entry)
    const id = readString(rec?.id)
    const label = readString(rec?.label)
    if (!rec || !id || !label) return null
    if (!Array.isArray(rec.models) || !Array.isArray(rec.aspectRatios) || !Array.isArray(rec.resolutions)) return null
    const models: VideoGenProviderOption['models'] = []
    for (const m of rec.models) {
      const mRec = asRecord(m)
      const mId = readString(mRec?.id)
      const mLabel = readString(mRec?.label)
      if (!mId || !mLabel) return null
      models.push({ id: mId, label: mLabel })
    }
    if (rec.aspectRatios.some((r) => typeof r !== 'string') || rec.resolutions.some((r) => typeof r !== 'string')) return null
    out.push({
      id,
      label,
      models,
      aspectRatios: rec.aspectRatios as string[],
      resolutions: rec.resolutions as string[],
    })
  }
  return out
}

function parseReferenceImageRefs(value: unknown): VideoGenReferenceImageRef[] | null {
  if (!Array.isArray(value)) return null
  const out: VideoGenReferenceImageRef[] = []
  for (const entry of value) {
    const rec = asRecord(entry)
    const path = readString(rec?.path)
    if (!rec || !path || !isVideoGenRole(rec.role)) return null
    out.push({ path, role: rec.role })
  }
  return out
}

/**
 * Extract a VideoGenConfirmPayload from an elicitation requestedSchema.
 *
 * The payload travels as a JSON string inside the `description` of the VIDEO_GEN_PARAMS_FIELD
 * property — a top-level custom key on requestedSchema would be silently stripped by the MCP
 * SDK's zod validation (ElicitRequestSchema restricts requestedSchema to the flat JSON Schema
 * subset), while per-field schema definitions survive verbatim.
 *
 * Shared by the Claude and Codex backends. Returns null on any shape mismatch so callers can
 * fall back to the generic form-field path.
 */
export function extractVideoGenConfirmPayload(schema: Record<string, unknown> | null): VideoGenConfirmPayload | null {
  if (!schema) return null
  const properties = asRecord(schema.properties)
  if (!properties) return null
  const fieldRec = asRecord(properties[VIDEO_GEN_PARAMS_FIELD])
  const description = readString(fieldRec?.description)
  if (!description) return null
  let raw: unknown
  try {
    raw = JSON.parse(description)
  } catch {
    return null
  }
  const rec = asRecord(raw)
  if (!rec) return null
  const params = parseVideoGenParams(rec.params)
  const providers = parseProviderOptions(rec.providers)
  const referenceImages = parseReferenceImageRefs(rec.referenceImages)
  if (!params || !providers || !referenceImages) return null
  return { params, providers, referenceImages }
}
