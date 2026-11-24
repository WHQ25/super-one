import { createHash } from 'node:crypto'
import { basename, resolve } from 'node:path'
import { COMPUTER_MEMORY_PLATFORMS, DEVICE_MEMORY_PLATFORMS, type MemoryFamily, type MemoryReadArgs } from '@superone/shared/interaction-memory'
import type { MemoryScope } from '@superone/shared/browser-memory'

export function deriveProjectMemoryKey(projectPath?: string): string | undefined {
  if (!projectPath || !projectPath.trim()) return undefined
  const normalized = resolve(projectPath.trim())
  const rawName = basename(normalized) || 'project'
  const slug = rawName.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'project'
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 8)
  return `${slug}-${hash}`
}

export interface MemoryTarget {
  segments: string[]
  bundleDepth: number
  scope: MemoryScope
  identity: { domain: string } | { platform: string; appId: string }
  readTool: string
  label: string
  indexHint: string
  /** OKF `resource`: canonical URI of the asset a note describes. */
  resource: string
}

export function normalizeMemoryDomain(value: string): string {
  try {
    if (typeof value !== 'string' || !value.trim() || /[\\\s]/.test(value)) throw new Error()
    const url = new URL(value.includes('://') ? value : `https://${value}`)
    const host = url.hostname.toLowerCase().replace(/\.$/, '')
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || host.length > 253
      || !host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw new Error()
    return host
  } catch { throw new Error('Invalid domain: provide an HTTP(S) URL or hostname without credentials.') }
}

export function resolveMemoryTarget(
  family: MemoryFamily,
  args: MemoryReadArgs,
  scope: MemoryScope = 'global',
  projectKey?: string,
): MemoryTarget {
  if (scope === 'project' && !projectKey) {
    throw new Error('Project memory scope requires an active project context.')
  }
  const prefix = scope === 'project' && projectKey ? ['projects', projectKey] : []
  const readTool = `${family}_memory_read`
  if (family === 'browser') {
    const domain = normalizeMemoryDomain('domain' in args ? args.domain : '')
    return {
      segments: [...prefix, 'browser', 'memory', domain],
      bundleDepth: prefix.length + 2,
      scope,
      identity: { domain },
      readTool,
      label: domain,
      resource: `https://${domain}/`,
      indexHint: `Call ${readTool} with domain and one topic for its Markdown and revision.`,
    }
  }
  if (family !== 'computer' && family !== 'device') throw new Error('Unknown memory family.')
  const platforms: readonly string[] = family === 'computer' ? COMPUTER_MEMORY_PLATFORMS : DEVICE_MEMORY_PLATFORMS
  if (!('platform' in args) || !platforms.includes(args.platform)) throw new Error(`Invalid platform for ${family} memory. Use the target app’s OS: ${platforms.join(', ')}.`)
  const appId = args.appId
  // Keep the stable identifier's spelling. Namespaces never accept filesystem paths.
  if (typeof appId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(appId)
    || /^\d+$/.test(appId) || appId.endsWith('.') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(appId)) {
    throw new Error('Invalid appId: use a stable bundle id, package name, application id or system; never a path, PID or snapshot ref.')
  }
  return {
    segments: [...prefix, family, 'memory', args.platform, appId],
    bundleDepth: prefix.length + 2,
    scope,
    identity: { platform: args.platform, appId },
    readTool,
    label: `${args.platform}/${appId}`,
    resource: `app://${args.platform}/${appId}`,
    indexHint: `Call ${readTool} with platform, appId and one topic for its Markdown and revision.`,
  }
}
