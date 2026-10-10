import { servesMethod } from '@superone/shared/environment'
import { decode, encode } from '@toon-format/toon'
import type { ArchiveToolResult, SessionArchiveTool } from '@superone/shared/session-archive'
import type { EnvironmentListItem, EnvironmentLiveStatus, EnvironmentMachine, SubscriptionUsage } from '@superone/shared/environment'
import type { ClaudeRateLimitWindow } from '@superone/shared/agent-types'
import type { EnvironmentInfoGroup } from '@superone/shared/environment/host-action-archive-descriptors'
import { currentCallOwner } from './artifact-registry'

type EnvironmentHostLike = Pick<import('../environment/environment-host').EnvironmentHost, 'getGateway'>

export function createEnvironmentArchiveTools(sessionId: string, connectionId?: string) {
  const environments = async (includeDescriptors = false) => {
    const { getEnvironmentHost } = await import('../environment/environment-host')
    const host = getEnvironmentHost()
    const items = await host.listEnvironments({ includeDescriptors })
    const callerConnection = connectionId ?? currentCallOwner() ?? 'local'
    const source = items.find(item => item.connectionId === callerConnection)
    if (!source) throw new Error('Source session environment is unavailable')
    return { host, items, source }
  }
  return {
    environmentGetInfo: async (args: EnvironmentGetInfoArgs = {}): Promise<ArchiveToolResult> => {
      try {
        const include = new Set<EnvironmentInfoGroup>(args.include ?? ['hardware'])
        const { host, items, source } = await environments(include.has('hardware'))
        const unique = [...new Map(items.map(item => [item.environmentId, item])).values()]
        const unknown = (args.environmentIds ?? []).filter(id => !unique.some(item => item.environmentId === id))
        if (unknown.length) throw new Error(`Unknown environment: ${unknown.join(', ')}. Call environment_get_info without environmentIds to list them.`)
        const selected = args.environmentIds ? unique.filter(item => args.environmentIds!.includes(item.environmentId)) : unique
        const rows = await Promise.all(selected.map(async (item) => {
          const row = environmentRow(item, item.environmentId === source.environmentId)
          if (!include.has('hardware')) return row
          return { ...row, ...hardwareColumns(await readHardware(host, item)) }
        }))
        const usage = include.has('usage') ? (await Promise.all(selected.map(item => readUsage(host, item)))).flat() : null
        return { content: [{ type: 'text', text: encode({ environments: rows, ...(usage ? { usage } : {}) }) }] }
      } catch (error) { return failure(error) }
    },
    archiveRead: async (tool: SessionArchiveTool, args: Record<string, unknown>, local: () => ArchiveToolResult): Promise<ArchiveToolResult> => {
      try {
        const { host, items, source } = await environments()
        const selector = typeof args.environmentId === 'string' ? args.environmentId : 'localhost'
        const environmentId = selector === 'localhost' ? source.environmentId : selector
        const target = items.find(item => item.environmentId === environmentId)
        if (!target) throw new Error('Unknown environment. Discover IDs with environment_list.')
        if (target.kind !== 'local') {
          const descriptor = await host.connect(target.connectionId)
          if (!servesMethod(descriptor.capabilities, 'session.archive')) throw new Error('This host does not support archive queries. Upgrade it.')
          if (descriptor.environmentId !== environmentId) throw new Error('Environment identity changed')
          const gateway = host.getGateway(environmentId)
          if (!gateway?.sessions.archive) throw new Error('This host does not support archive queries. Upgrade it.')
          return await gateway.sessions.archive({ tool, args: { ...args, environmentId: selector }, ...(source.environmentId === environmentId ? { sourceSessionId: sessionId } : {}) })
        }
        if (source.environmentId !== environmentId && tool !== 'project_list' && tool !== 'session_read' && !args.projectId && args.allProjects !== true) throw new Error('Pass projectId or allProjects: true for another environment.')
        const reply = local()
        if (reply.isError) return reply
        const text = reply.content[0]?.text ?? ''
        let object: Record<string, unknown> | null = null
        try { object = JSON.parse(text) as Record<string, unknown> } catch {
          if (tool !== 'session_read') object = decode(text) as Record<string, unknown>
        }
        if (object && source.environmentId !== environmentId) {
          // IDs are only unique within a host; a foreign caller cannot be "self" here.
          if ('isSelf' in object) object.isSelf = false
          for (const field of ['sessions', 'projects']) if (Array.isArray(object[field])) object[field] = (object[field] as Record<string, unknown>[]).map(row => ({ ...row, ...('isSelf' in row ? { isSelf: false } : {}), ...('isCurrent' in row ? { isCurrent: false } : {}) }))
        }
        return { ...reply, content: [{ type: 'text', text: object ? (tool === 'session_read' ? JSON.stringify({ environmentId: selector, ...object }) : encode({ environmentId: selector, ...object })) : `environmentId: ${selector}\n${text}` }] }
      } catch (error) { return failure(error) }
    },
  }
}
export interface EnvironmentGetInfoArgs {
  environmentIds?: string[]
  include?: EnvironmentInfoGroup[]
}

const gib = (bytes: number) => Math.round((bytes / 2 ** 30) * 10) / 10

/** Identity columns every `environment_get_info` row carries. */
export function environmentRow(item: EnvironmentListItem, isLocal: boolean) {
  return {
    environmentId: item.environmentId,
    label: item.label,
    isLocal,
    state: item.state,
    searchable: item.kind === 'local' || servesMethod(item.capabilities, 'session.archive'),
  }
}

async function readHardware(host: EnvironmentHostLike, item: EnvironmentListItem): Promise<{ item: EnvironmentListItem; machine?: EnvironmentMachine; live?: EnvironmentLiveStatus }> {
  if (item.kind === 'local') {
    const { readLocalNodeContext } = await import('../environment/local-node-context')
    return { item, ...(await readLocalNodeContext()) }
  }
  // Older nodes reject environment.status as unsupported; their free memory stays null.
  const live = item.state === 'connected' ? await host.getGateway(item.environmentId)?.getLiveStatus?.().catch(() => undefined) : undefined
  return { item, machine: item.machine, live }
}

/**
 * Hardware columns. Every row carries every column (null when unknown:
 * offline, or a node too old to report it) so TOON keeps its table form.
 */
export function hardwareColumns({ item, machine, live }: { item: EnvironmentListItem; machine?: EnvironmentMachine; live?: EnvironmentLiveStatus }) {
  return {
    os: machine?.os ?? item.platform?.os ?? null,
    arch: item.platform?.arch ?? null,
    cpu: machine ? [machine.cpuModel, `${machine.cpuCores} cores`].filter(Boolean).join(', ') : null,
    gpus: machine?.gpus?.join('; ') ?? null,
    memoryGb: machine ? gib(machine.memoryBytes) : null,
    freeMemoryGb: live ? gib(live.freeMemoryBytes) : null,
  }
}

async function readUsage(host: EnvironmentHostLike, item: EnvironmentListItem) {
  if (item.state !== 'connected') return []
  try {
    if (item.kind === 'local') {
      const { readLocalSubscriptionUsage } = await import('../agent/subscription-usage')
      return usageRows(item.environmentId, await readLocalSubscriptionUsage())
    }
    const gateway = host.getGateway(item.environmentId)
    if (!gateway?.getUsage) return []
    return usageRows(item.environmentId, (await gateway.getUsage()).accounts)
  } catch (error) {
    // Older nodes reject environment.usage as unsupported.
    return [usageRow(item.environmentId, null, null, error instanceof Error ? error.message : String(error))]
  }
}

function usageRow(environmentId: string, usage: SubscriptionUsage | null, window: ClaudeRateLimitWindow | null, error: string | null) {
  return {
    environmentId,
    harness: usage?.harness ?? null,
    account: usage?.account ?? null,
    plan: usage?.planType ?? null,
    window: window?.label ?? null,
    usedPercent: window ? Math.round(window.usedPercent * 10) / 10 : null,
    resetsAt: window?.resetsAt ? new Date(window.resetsAt * 1000).toISOString() : null,
    error,
  }
}

/** One row per quota window; a subscription without windows keeps one row carrying its error. */
export function usageRows(environmentId: string, accounts: SubscriptionUsage[]) {
  return accounts.flatMap(usage => usage.windows.length
    ? usage.windows.map(window => usageRow(environmentId, usage, window, usage.error ?? null))
    : [usageRow(environmentId, usage, null, usage.error ?? null)])
}

function failure(error: unknown): ArchiveToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ status: 'error', message: error instanceof Error ? error.message : 'Environment read failed' }) }], isError: true }
}
