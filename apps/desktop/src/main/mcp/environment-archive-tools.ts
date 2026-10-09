import { decode, encode } from '@toon-format/toon'
import type { ArchiveToolResult, SessionArchiveTool } from '@superone/shared/session-archive'
import type { EnvironmentListItem, EnvironmentLiveStatus, EnvironmentMachine } from '@superone/shared/environment'
import { currentCallOwner } from './artifact-registry'

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
    environmentList: async (): Promise<ArchiveToolResult> => {
      try {
        const { host, items, source } = await environments(true)
        const unique = [...new Map(items.map(item => [item.environmentId, item])).values()]
        const rows = await Promise.all(unique.map(async (item) => {
          const isLocal = item.environmentId === source.environmentId
          if (item.kind === 'local') {
            const { readLocalNodeContext } = await import('../environment/local-node-context')
            return environmentRow(item, isLocal, await readLocalNodeContext())
          }
          // Older nodes reject environment.status as unsupported; their free memory stays null.
          const live = item.state === 'connected' ? await host.getGateway(item.environmentId)?.getLiveStatus?.().catch(() => undefined) : undefined
          return environmentRow(item, isLocal, { machine: item.machine, live })
        }))
        return { content: [{ type: 'text', text: encode({ environments: rows }) }] }
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
          if (!descriptor.capabilities.sessionArchive) throw new Error('This host does not support archive queries. Upgrade it.')
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
const gib = (bytes: number) => Math.round((bytes / 2 ** 30) * 10) / 10

/**
 * One flat `environment_list` row. Every row carries every column (null when
 * unknown: offline, or a node too old to report it) so TOON keeps its table form.
 */
export function environmentRow(item: EnvironmentListItem, isLocal: boolean, facts: { machine?: EnvironmentMachine; live?: EnvironmentLiveStatus }) {
  const { machine, live } = facts
  return {
    environmentId: item.environmentId,
    label: item.label,
    isLocal,
    state: item.state,
    searchable: item.kind === 'local' || item.capabilities?.sessionArchive === true,
    os: machine?.os ?? item.platform?.os ?? null,
    arch: item.platform?.arch ?? null,
    cpu: machine ? [machine.cpuModel, `${machine.cpuCores} cores`].filter(Boolean).join(', ') : null,
    gpus: machine?.gpus?.join('; ') ?? null,
    memoryGb: machine ? gib(machine.memoryBytes) : null,
    freeMemoryGb: live ? gib(live.freeMemoryBytes) : null,
  }
}

function failure(error: unknown): ArchiveToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ status: 'error', message: error instanceof Error ? error.message : 'Environment read failed' }) }], isError: true }
}
