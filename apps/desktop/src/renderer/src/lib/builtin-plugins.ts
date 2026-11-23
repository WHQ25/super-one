import type { ClientKernel, KernelScope } from '@superone/client-kernel'
import { registerReviewPlugin } from '@/components/review/review-plugin'
import { registerTrajectoryPlugin } from '@/components/trajectory/trajectory-plugin'

const registeredByKernel = new WeakMap<ClientKernel, Map<string, KernelScope>>()

export function ensureBuiltinClientPlugins(kernel: ClientKernel): Map<string, KernelScope> {
  let scopes = registeredByKernel.get(kernel)
  if (scopes) return scopes
  scopes = new Map<string, KernelScope>()
  registeredByKernel.set(kernel, scopes)
  scopes.set('builtin.review', registerReviewPlugin(kernel))
  scopes.set('builtin.trajectory', registerTrajectoryPlugin(kernel))
  return scopes
}

export function getBuiltinClientPluginScope(kernel: ClientKernel, id: string): KernelScope | undefined {
  return registeredByKernel.get(kernel)?.get(id)
}

export function disposeBuiltinClientPlugins(kernel: ClientKernel): void {
  const scopes = registeredByKernel.get(kernel)
  if (!scopes) return
  for (const scope of scopes.values()) {
    scope.dispose()
  }
  scopes.clear()
  registeredByKernel.delete(kernel)
}
