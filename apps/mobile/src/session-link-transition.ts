import type { SessionLinkPreparation } from './session-link-navigation'
import type { ChatRuntime } from './runtime'
import type { AgentEvent } from '@superone/shared/agent-types'

/** Hydrate off-screen; source ownership changes only after all preparation succeeds. */
export async function activatePreparedSessionLink(prepared: SessionLinkPreparation, options: {
  isCurrent(): boolean
  createRuntime(): Pick<ChatRuntime, 'open' | 'ingest' | 'dispose'>
  parkSource(): Promise<void>
  adoptConnection(): Promise<boolean>
  ownsConnection(): boolean
  leaveSource(): void
  activate(runtime: Pick<ChatRuntime, 'open' | 'ingest' | 'dispose'>): void
}): Promise<void> {
  let runtime: ReturnType<typeof options.createRuntime> | undefined
  let committed = false
  try {
    if (!options.isCurrent()) { prepared.retire(); return }
    runtime = options.createRuntime()
    const replayed = prepared.restored.liveBatches.length
    await runtime.open(prepared.target.projectPath, prepared.target.ref.sessionId, prepared.restored)
    if (!options.isCurrent()) { runtime.dispose(); prepared.retire(); return }
    await options.parkSource()
    if (!options.isCurrent()) { runtime.dispose(); prepared.retire(); return }
    if (prepared.connection) {
      if (!await options.adoptConnection() || !options.ownsConnection()) { runtime.dispose(); prepared.retire(); return }
    } else options.leaveSource()
    prepared.commit()
    committed = true
    // Events received while the detached runtime hydrated were buffered by the route.
    runtime.ingest(prepared.restored.liveBatches.slice(replayed).flat() as AgentEvent[], prepared.restored.epoch)
    options.activate(runtime)
  } catch (error) {
    if (!committed) { runtime?.dispose(); prepared.retire() }
    throw error
  }
}
