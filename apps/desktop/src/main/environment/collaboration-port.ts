/**
 * Collaboration's view of paired machines, served by EnvironmentHost: the
 * gateway calls a remote spawn child needs, keyed by connectionId (which
 * changes on re-pair, so collaboration stores environmentIds instead).
 */

import type { SessionAgentProfile } from '@superone/shared/agent-types'
import { nodeProjectsDir, type NodeAgentSettings } from '@superone/shared/environment'
import type { RemoteCollaborationPort } from '../session/collaboration-remote'
import { getEnvironmentHost } from './environment-host'
import { RemoteEnvironmentGateway } from './remote-environment-gateway'

export function environmentHostCollaborationPort(): RemoteCollaborationPort {
  const host = getEnvironmentHost()
  const gateway = async (connectionId: string): Promise<RemoteEnvironmentGateway> => {
    const env = (await host.listEnvironments({ includeDescriptors: false }))
      .find((item) => item.connectionId === connectionId)
    const gw = env ? host.getGateway(env.environmentId) : null
    if (!(gw instanceof RemoteEnvironmentGateway)) {
      throw Object.assign(new Error('environment is not connected'), { code: 'failed_precondition' })
    }
    return gw
  }
  return {
    async listEnvironments() {
      const items = await host.listEnvironments({ includeDescriptors: true })
      return items.filter((item) => item.kind === 'remote').map((item) => ({
        environmentId: item.environmentId,
        connectionId: item.connectionId,
        label: item.label,
        connected: item.state === 'connected',
        harnessIds: item.capabilities?.harnessIds ?? [],
      }))
    },
    listProjects: (connectionId) => host.listProjects(connectionId, { refresh: true }),
    async projectsDir(connectionId) {
      const result = await (await gateway(connectionId)).settingsGet() as { settings?: NodeAgentSettings } | null
      return nodeProjectsDir(result?.settings ?? {})
    },
    clone: (connectionId, input) => host.cloneRepository(connectionId, { ...input, ifExists: 'reuse-or-rename' }),
    async fetch(connectionId, projectId) {
      await (await gateway(connectionId)).gitFetch(projectId, 'origin')
    },
    async activateWorktree(connectionId, projectId, input) {
      return await (await gateway(connectionId)).gitWorktreeActivate(projectId, input) as { path: string }
    },
    async listProfiles(connectionId) {
      return await (await gateway(connectionId)).collaborationListProfiles() as SessionAgentProfile[]
    },
    async createSession(connectionId, input) {
      return (await gateway(connectionId)).sessions.create({
        project: { environmentId: input.environmentId, projectId: input.projectId },
        providerId: input.providerId,
        title: input.title,
        cwd: input.cwd,
        systemPromptAppend: input.systemPromptAppend,
        externalParent: { sessionId: input.externalParentSessionId },
        options: input.options,
      })
    },
    send(connectionId, input) {
      return new Promise<void>((resolve, reject) => {
        host.sendSessionMessage(connectionId, {
          ...input,
          // Nobody echoed this turn's text; show it from the node's events.
          echoUserMessage: true,
          onAccepted: resolve,
        }).then(() => resolve(), reject)
      })
    },
    async eventHead(connectionId) {
      return (await gateway(connectionId)).eventHeadSequence()
    },
    listEvents: (connectionId, afterSequence) => host.listSessionEvents(connectionId, afterSequence),
    watchEvents: (connectionId, sessionId, onEvent) => host.watchRemoteSessionEvents(connectionId, sessionId, onEvent),
    onConnectionChange: (listener) => host.onStatusChange(() => listener()),
    async getSession(connectionId, sessionId) {
      const record = await host.getSession(connectionId, sessionId) as { status?: string; pendingInteraction?: unknown } | null
      return record ? { status: record.status ?? 'idle', pendingInteraction: record.pendingInteraction ?? null } : null
    },
  }
}
