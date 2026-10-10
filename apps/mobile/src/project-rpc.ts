import type { MobileRpcClient } from './runtime-session-rpc'
import type { PhoneRpcOptions } from '@superone/relay-client'
import type { RelayClient } from '@superone/relay-client'

export type ProjectRpcClient = Pick<MobileRpcClient, 'rpc' | 'resolveProject'>

/** Host paths are display data; the authenticated catalog owns routing and project identity. */
export async function projectRpc<T>(client: ProjectRpcClient, projectPath: string, method: string, payload: Record<string, unknown> = {}, options: Omit<PhoneRpcOptions, 'environmentId'> = {}): Promise<T> {
  const project = await client.resolveProject(projectPath)
  return client.rpc(method, { ...payload, projectId: project.projectId }, { ...options, environmentId: project.environmentId }) as Promise<T>
}

export async function operateProjectSession<T>(client: RelayClient, projectPath: string, sessionId: string, method: string, payload: Record<string, unknown>): Promise<T> {
  const project = await client.resolveProject(projectPath)
  return client.operateSession<T>({ environmentId: project.environmentId, sessionId }, method, payload)
}
