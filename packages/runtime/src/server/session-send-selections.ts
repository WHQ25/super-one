import type { SessionSendSelections } from '@superone/shared/environment/session-send'

const invalid = (message: string) => Object.assign(new Error(message), { code: 'invalid_argument' })
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

/** Preserve the composer fields; a malformed selection must not silently become a normal send. */
export function parseSessionSendSelections(p: Record<string, unknown>, options: Record<string, unknown>): SessionSendSelections {
  const result: SessionSendSelections = {}
  const take = (key: keyof SessionSendSelections) => Object.hasOwn(options, key) ? options[key] : p[key]
  const priority = take('priority')
  if (priority !== undefined) {
    if (priority !== 'now' && priority !== 'next' && priority !== 'later') throw invalid('priority must be now|next|later')
    result.priority = priority
  }
  const steer = take('steer')
  if (steer !== undefined) {
    if (steer !== 'now' && steer !== 'next') throw invalid('steer must be now|next')
    if (typeof p.clientMessageId !== 'string' || !p.clientMessageId) throw invalid('steer requires clientMessageId')
    result.steer = steer
  }
  for (const key of ['agent', 'threadId'] as const) {
    const value = take(key)
    if (value === undefined) continue
    if (typeof value !== 'string' || !value.trim()) throw invalid(`${key} must be a nonempty string`)
    result[key] = value
  }
  const permissionPreset = take('permissionPreset')
  if (permissionPreset !== undefined) {
    if (permissionPreset !== 'read-only' && permissionPreset !== 'default' && permissionPreset !== 'auto-review' && permissionPreset !== 'full-access') throw invalid('invalid permissionPreset')
    result.permissionPreset = permissionPreset
  }
  const serviceTier = take('serviceTier')
  if (serviceTier !== undefined) {
    if (serviceTier !== null && (typeof serviceTier !== 'string' || !serviceTier.trim())) throw invalid('serviceTier must be a nonempty string or null')
    result.serviceTier = serviceTier
  }
  const modelParams = take('modelParams')
  if (modelParams !== undefined) {
    if (!record(modelParams) || Object.values(modelParams).some(value => typeof value !== 'string')) throw invalid('modelParams must map names to string values')
    result.modelParams = { ...modelParams } as Record<string, string>
  }
  const inputRequest = take('inputRequest')
  if (inputRequest !== undefined) {
    if (!record(inputRequest) || typeof inputRequest.requestId !== 'string' || !inputRequest.requestId || !record(inputRequest.values)) throw invalid('inputRequest requires requestId and values')
    if (typeof p.clientMessageId !== 'string' || !p.clientMessageId) throw invalid('inputRequest requires clientMessageId')
    result.inputRequest = { requestId: inputRequest.requestId, values: inputRequest.values }
  }
  return result
}
