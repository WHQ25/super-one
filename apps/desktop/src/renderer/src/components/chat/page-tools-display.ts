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

/** Parse `browser_tools_list`: `{ origin, count, tools[] }` or `{ count: 0, hint }`. */
export function parsePageToolsList(result: string | undefined): PageToolsListInfo | null {
  if (!result) return null
  let data: unknown
  try { data = JSON.parse(result) } catch { return null }
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
const UNTRUSTED_BANNER = /^Output from untrusted web page (\S+)[^\n]*:\n/

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
