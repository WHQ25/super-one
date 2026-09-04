import { decode as toonDecode } from '@toon-format/toon'

export function tryParseJson(text: string | null | undefined): unknown {
  if (!text) return null
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

export function tryParseToon(text: string | null | undefined): unknown {
  if (!text) return null
  try {
    return toonDecode(text)
  } catch {
    return null
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function shortId(id: string, length = 8): string {
  return id.length <= length ? id : `${id.slice(0, length)}…`
}

export function relativeish(iso: string): string {
  if (!iso) return ''
  return iso.length >= 10 ? iso.slice(0, 10) : iso
}

/** Compact size for list rows (character-length ranking metric, not disk bytes). */
export function formatSizeChars(value: number): string {
  if (!Number.isFinite(value) || value < 0) return ''
  if (value < 1000) return String(Math.round(value))
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`
  return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0)}M`
}

/** Local calendar display for session rows. */
export function formatMinute(iso: string, now = new Date()): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    const match = iso.match(/^(\d{4})-(\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/)
    if (!match) return relativeish(iso)
    return Number(match[1]) === now.getFullYear()
      ? match[3] ? `${match[2]} ${match[3]}` : match[2]!
      : `${match[1]}-${match[2]}`
  }
  const pad = (value: number) => String(value).padStart(2, '0')
  const year = date.getFullYear()
  const monthDay = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return year === now.getFullYear()
    ? `${monthDay} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    : `${year}-${monthDay}`
}
