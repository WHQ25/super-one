import type { EnvironmentGateway, PatchSessionSettingsInput } from '@superone/shared/environment'

export interface RemoteSessionCreateInput {
  projectId: string
  title?: string
  providerId?: string
  harnessId?: string
  cwd?: string | null
  settings?: Omit<PatchSessionSettingsInput, 'session' | 'leaseId' | 'generation'>
}

/** Finish inherited settings before exposing the new session to navigation/send. */
export async function createRemoteSession(input: RemoteSessionCreateInput, ports: {
  gateway: EnvironmentGateway
  environmentId: string
  control(sessionId: string): Promise<{ leaseId: string; generation: string }>
  setCwd(sessionId: string, cwd: string | null): Promise<unknown>
}): Promise<unknown> {
  const harnessId = input.harnessId ?? 'claude'
  const providerId = input.providerId ?? harnessId
  if (input.settings && !ports.gateway.sessions.patchSettings) throw new Error('The node cannot inherit conversation settings')
  const { sessionId } = await ports.gateway.sessions.create({
    project: { environmentId: ports.environmentId, projectId: input.projectId },
    providerId, title: input.title, options: { harnessId },
  })
  if (input.settings) {
    const control = await ports.control(sessionId)
    await ports.gateway.sessions.patchSettings!({ session: { environmentId: ports.environmentId, sessionId }, ...input.settings, ...control })
  }
  if (input.cwd !== undefined) await ports.setCwd(sessionId, input.cwd)
  const session = await ports.gateway.sessions.get({ environmentId: ports.environmentId, sessionId })
  if (input.settings) {
    const identity = session as { harnessId?: string; providerId?: string } | null
    if (identity?.harnessId !== harnessId || identity.providerId !== providerId) throw new Error('The new node conversation does not match its source harness/provider')
  }
  return session ?? { sessionId, title: input.title, harnessId, providerId }
}
