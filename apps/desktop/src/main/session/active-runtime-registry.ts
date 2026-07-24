export const IDLE_RUNTIME_TIMEOUT_MS = 30 * 60 * 1000
export const MIN_ACTIVE_RUNTIMES_FOR_IDLE_RELEASE = 5

const runtimes = new Map<object, () => boolean>()

export function registerActiveRuntime(owner: object, isActive: () => boolean): void {
  runtimes.set(owner, isActive)
}

export function unregisterActiveRuntime(owner: object): void {
  runtimes.delete(owner)
}

export function getActiveRuntimeCount(): number {
  let count = 0
  for (const isActive of runtimes.values()) {
    if (isActive()) count += 1
  }
  return count
}

export function resetActiveRuntimeRegistryForTests(): void {
  runtimes.clear()
}
