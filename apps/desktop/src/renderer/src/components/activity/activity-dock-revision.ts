/**
 * Bumped when the live dock's tabs change, so a hover card can recount without
 * subscribing to dockview itself.
 */
let revision = 0
const listeners = new Set<() => void>()

export function bumpActivityDockRevision(): void {
  revision += 1
  for (const listener of listeners) listener()
}

export function subscribeActivityDockRevision(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function activityDockRevision(): number {
  return revision
}
