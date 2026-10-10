import type { MobileRpcClient } from './runtime-session-rpc'

export const resolveTestProject = async (_path: string) => ({ environmentId: 'desktop', projectId: 'p' })
export function projectTestClient<T extends MobileRpcClient['rpc']>(rpc: T) {
  return { rpc, resolveProject: resolveTestProject }
}
