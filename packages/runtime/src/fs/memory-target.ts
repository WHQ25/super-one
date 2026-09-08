import { COMPUTER_MEMORY_PLATFORMS, DEVICE_MEMORY_PLATFORMS, type MemoryFamily, type MemoryReadArgs } from '@superone/shared/interaction-memory'

export interface MemoryTarget {
  segments: string[]
  identity: { domain: string } | { platform: string; appId: string }
  readTool: string
  label: string
  indexHint: string
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

export function resolveMemoryTarget(family: MemoryFamily, args: MemoryReadArgs): MemoryTarget {
  const readTool = `${family}_memory_read`
  if (family === 'browser') {
    const domain = normalizeMemoryDomain('domain' in args ? args.domain : '')
    return { segments: ['browser', 'memory', domain], identity: { domain }, readTool, label: domain,
      indexHint: `Call ${readTool} with domain and one topic for its Markdown and revision.` }
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
  return { segments: [family, 'memory', args.platform, appId], identity: { platform: args.platform, appId }, readTool,
    label: `${args.platform}/${appId}`, indexHint: `Call ${readTool} with platform, appId and one topic for its Markdown and revision.` }
}
