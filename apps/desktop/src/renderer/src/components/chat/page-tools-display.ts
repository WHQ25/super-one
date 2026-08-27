/**
 * Parsing for the two WebMCP page-tool results (`browser_tools_list` / `browser_tools_call`).
 * Kept out of browser-tool-display.ts so that module stays under the size limit; the shapes
 * here are produced by apps/desktop/src/main/mcp/browser-mcp-tools.ts.
 */

export interface PageToolDef {
  name: string
  description?: string
}

export interface PageToolsListInfo {
  /** Page origin (`https://example.com`) — absent when the page registered nothing. */
  origin?: string
  count: number
  tools: PageToolDef[]
  /** Reason the list is empty (WebMCP disabled, page registered no tools). */
  hint?: string
}

/**
 * The catalog is prefixed with an untrusted-content banner aimed at the model. Everything from
 * the first `{` on is the payload; the prose above it is prompt plumbing the user never sees.
 */
function stripUntrustedPrefix(result: string): string {
  const brace = result.indexOf('{')
  return brace > 0 ? result.slice(brace) : result
}

/** Parse `browser_tools_list`: `{ origin, count, tools[] }` or `{ count: 0, hint }`. */
export function parsePageToolsList(result: string | undefined): PageToolsListInfo | null {
  if (!result) return null
  let data: unknown
  try { data = JSON.parse(stripUntrustedPrefix(result)) } catch { return null }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const obj = data as Record<string, unknown>
  if (typeof obj.count !== 'number' && !Array.isArray(obj.tools)) return null

  const tools: PageToolDef[] = []
  for (const entry of Array.isArray(obj.tools) ? obj.tools : []) {
    if (!entry || typeof entry !== 'object') continue
    const tool = entry as Record<string, unknown>
    if (typeof tool.name !== 'string' || !tool.name) continue
    tools.push({
      name: tool.name,
      description: typeof tool.description === 'string' && tool.description.trim()
        ? tool.description.trim()
        : undefined,
    })
  }
  return {
    origin: typeof obj.origin === 'string' ? obj.origin : undefined,
    count: typeof obj.count === 'number' ? obj.count : tools.length,
    tools,
    hint: typeof obj.hint === 'string' ? obj.hint : undefined,
  }
}

/**
 * `browser_tools_call` wraps page output in an untrusted-data banner so the model treats it
 * as data. The banner is prompt plumbing, not something the user needs to read — strip it and
 * keep the origin it carries (the only place the call result names the page).
 */
const UNTRUSTED_BANNER = /^Output from untrusted web page (\S+)[^\n]*\n/

/** The `browser_tools_list` counterpart. Its banner wraps three lines, so only the first is matched. */
const CATALOG_BANNER = /^Tool catalog declared by untrusted web page (\S+)/

export interface PageToolCallInfo {
  origin?: string
  output: string
}

export function parsePageToolCall(result: string | undefined): PageToolCallInfo {
  if (!result) return { output: '' }
  const match = result.match(UNTRUSTED_BANNER)
  if (!match) return { output: result }
  return { origin: match[1], output: result.slice(match[0].length) }
}

/** `https://example.com:8443` → `example.com:8443`. */
export function originHost(origin: string | undefined): string {
  return origin ? origin.replace(/^[a-z]+:\/\//i, '').replace(/\/$/, '') : ''
}

function scalar(value: unknown, max: number): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value)
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

/** One-line `key: value · key: value` preview of a page tool's arguments. */
export function pageToolInputSummary(input: unknown, max = 72): string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return ''
  const parts: string[] = []
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (value === undefined) continue
    parts.push(`${key}: ${scalar(value, 24)}`)
  }
  const summary = parts.join(' · ')
  return summary.length > max ? `${summary.slice(0, max)}…` : summary
}

/** Strips the harness/host error decorations so the row shows the sentence, not the plumbing. */
function cleanFailureText(text: string): string {
  return text
    .replace(/^\[Error\]\s*/, '')
    .replace(/<\/?tool_use_error>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function jsonObject(text: string): Record<string, unknown> | null {
  if (!text.startsWith('{')) return null
  try {
    const data: unknown = JSON.parse(text)
    return data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : null
  } catch {
    return null
  }
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

export interface PageToolOutcome {
  status: 'ok' | 'denied' | 'error'
  /** Page the call belongs to. Absent only when the failure happened above the host. */
  origin?: string
  /** One-line reason for a denied / error row; empty when the call succeeded. */
  message: string
}

/**
 * Classifies a page-tool result into the three outcomes the row can paint.
 *
 * Every reply the host writes is either an untrusted-content banner (real page output or a tool
 * catalog) or a JSON envelope carrying its own `status`. **A result in neither shape was produced
 * above the host** — the MCP layer rejecting `browser_tools_call`'s arguments, or a harness
 * refusing the call — and it is the only signal available, because harnesses that flatten an MCP
 * protocol error into result text send no `isError` flag with it (Cursor does exactly this with
 * `MCP error -32602: …`). Falling through to "ok" there is worse than cosmetic: the row then
 * presents a host-side failure as data the page returned.
 */
export function parsePageToolOutcome(
  result: string | undefined,
  { isError, isDenied }: { isError?: boolean; isDenied?: boolean } = {},
): PageToolOutcome {
  const text = result?.trim() ?? ''
  // `[denied] ` is stripped upstream in ToolBlock; what is left is the reason the user gave.
  if (isDenied) return { status: 'denied', message: cleanFailureText(text) }
  // A flagged failure with no text still failed — the row falls back to the arguments for a summary.
  if (!text) return { status: isError ? 'error' : 'ok', message: '' }

  const bannerOrigin = text.match(UNTRUSTED_BANNER)?.[1] ?? text.match(CATALOG_BANNER)?.[1]
  if (bannerOrigin) {
    return isError
      ? { status: 'error', origin: bannerOrigin, message: cleanFailureText(text) }
      : { status: 'ok', origin: bannerOrigin, message: '' }
  }

  const obj = jsonObject(text)
  if (!obj) return { status: 'error', message: cleanFailureText(text) }

  const origin = typeof obj.origin === 'string' ? obj.origin : undefined
  // The host answers a refused site with `hint`, a refused call with `reason` — the row needs
  // whichever is present, or a denied badge with no explanation is all the user gets.
  const reason = firstString(obj.reason, obj.hint, obj.error)
  if (obj.status === 'denied' || obj.status === 'cancelled') {
    return { status: 'denied', origin, message: reason ?? '' }
  }
  if (isError || obj.ok === false) {
    return { status: 'error', origin, message: reason ?? cleanFailureText(text) }
  }
  return { status: 'ok', origin, message: '' }
}
