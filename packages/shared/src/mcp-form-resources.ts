import type { McpAppReadResult } from './mcp-apps'
import type { SchemaFormResource } from './schema-form'

/** Host callbacks; callers send field/option identities, never paths or preview targets. */
export interface McpFormResourceActions {
  pick(field: string): Promise<SchemaFormResource[]>
  preview(field: string, optionUri: string): Promise<McpAppReadResult>
}

export function validResourceAccept(value: string): boolean {
  return value.length <= 256 && (/^\.[a-z0-9][a-z0-9._+-]*$/i.test(value)
    || /^[a-z0-9!#$&^_.+-]+\/(?:[a-z0-9!#$&^_.+-]+|\*)$/i.test(value))
}

/** Filename/MIME filtering, as with HTML accept; not a file-content trust assertion. */
export function matchesResourceAccept(name: string, mimeType: string, accept?: readonly string[]): boolean {
  if (!accept?.length) return true
  const lower = name.toLowerCase()
  const mime = mimeType.toLowerCase()
  return accept.some((raw) => {
    if (!validResourceAccept(raw)) return false
    const rule = raw.toLowerCase()
    return rule.startsWith('.') ? lower.endsWith(rule)
      : rule.endsWith('/*') ? mime.startsWith(rule.slice(0, -1)) : mime === rule
  })
}
