import { mobileLog } from '../logger'

/** One upload is one phone-side batch; anything past these is not a diagnostic. */
const MAX_ENTRIES = 500
const MAX_FIELDS = 16
const MAX_TEXT = 200
const TAG = /^[\w.:-]{1,40}$/

/**
 * Append a phone's buffered diagnostic lines to `mobile.log`, returning how many
 * were written. The phone is paired but still remote input: every line is
 * rebuilt from validated primitives, one line each, so nothing it sends can
 * forge another line or grow without bound.
 */
export function appendMobileLog(deviceId: string, entries: unknown): number {
  if (!Array.isArray(entries)) return 0
  const device = text(deviceId).slice(0, 8)
  const logger = mobileLog()
  let written = 0
  for (const entry of entries.slice(0, MAX_ENTRIES)) {
    const line = formatEntry(entry)
    if (!line) continue
    logger.info(`[${line.at}] [${device}] ${line.body}`)
    written++
  }
  return written
}

function formatEntry(entry: unknown): { at: string; body: string } | null {
  if (!entry || typeof entry !== 'object') return null
  const { at, tag, fields } = entry as { at?: unknown; tag?: unknown; fields?: unknown }
  if (typeof at !== 'string' || Number.isNaN(Date.parse(at)) || typeof tag !== 'string' || !TAG.test(tag)) return null
  const parts = [tag]
  if (fields && typeof fields === 'object') {
    for (const [key, value] of Object.entries(fields).slice(0, MAX_FIELDS)) {
      if (!TAG.test(key)) continue
      if (value !== null && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue
      parts.push(`${key}=${typeof value === 'string' ? JSON.stringify(text(value)) : String(value)}`)
    }
  }
  return { at: new Date(at).toISOString(), body: parts.join(' ') }
}

function text(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').slice(0, MAX_TEXT)
}
