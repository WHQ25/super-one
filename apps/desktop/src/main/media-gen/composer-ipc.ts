import { randomUUID } from 'node:crypto'
import { ipcMain, type WebContents } from 'electron'
import { MediaComposerChannels as channels, type MediaComposerRequest, type MediaComposerResult, type MediaComposerTarget } from '@superone/shared/media-composer'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import type { Session } from '../session/types'

/** Per-window handles prevent one renderer from cancelling another renderer's generation. */
export function registerMediaComposerIpc(getSession: (id: string) => Session | null): void {
  const running = new Map<string, AbortController>()
  const watched = new WeakSet<WebContents>()
  const statuses = new Map<string, Promise<MediaComposerResult>>()
  const key = (sender: WebContents, id: string) => `${sender.id}:${id}`
  const watch = (sender: WebContents) => {
    if (watched.has(sender)) return
    watched.add(sender)
    sender.once('destroyed', () => {
      for (const [id, controller] of running) if (id.startsWith(`${sender.id}:`)) controller.abort()
    })
  }
  const validateOwner = async (target: MediaComposerTarget) => {
    const { validateMediaTarget } = await import('./composer-service')
    validateMediaTarget(target)
    const remote = parseRemoteProjectKey(target.projectPath)
    if (remote) {
      const { getEnvironmentHost } = await import('../environment/environment-host')
      const host = getEnvironmentHost()
      const snapshot = await host.getSession(remote.connectionId, target.sessionId) as { projectId?: string } | null
      if (!snapshot?.projectId || await host.getRemoteProjectPath(remote.connectionId, snapshot.projectId) !== remote.path) {
        throw new Error('Remote media session does not belong to this project')
      }
    } else {
      const session = getSession(target.sessionId)
      if (session && session.projectPath !== target.projectPath) throw new Error('Media session belongs to another project')
    }
  }

  ipcMain.handle(channels.models, async (_event, kind) => (await import('./composer-models')).mediaComposerModels(kind))
  ipcMain.handle(channels.generate, async (event, request: MediaComposerRequest) => {
    // Validate the identity before using it as a key, then install cancellation before any awaits.
    if (!request || typeof request.requestId !== 'string') throw new Error('Invalid media request')
    const id = key(event.sender, request.requestId)
    if (running.has(id)) throw new Error('Media request is already running')
    const controller = new AbortController()
    running.set(id, controller)
    watch(event.sender)
    try {
      await validateOwner(request)
      controller.signal.throwIfAborted()
      return await inMediaScope(request, controller.signal, async () => {
        const result = await (await import('./composer-service')).generateComposerMedia(request, controller.signal)
        if (request.kind === 'image') controller.signal.throwIfAborted()
        return result
      })
    } finally { running.delete(id) }
  })
  ipcMain.handle(channels.cancel, (event, id: string) => { running.get(key(event.sender, id))?.abort() })
  ipcMain.handle(channels.pendingVideos, async (_event, target: MediaComposerTarget) => {
    await validateOwner(target)
    return (await import('./composer-service')).pendingComposerVideos(target)
  })
  ipcMain.handle(channels.videoStatus, async (_event, target: MediaComposerTarget, id: string) => {
    if (!target || typeof id !== 'string') throw new Error('Invalid video status request')
    const statusKey = JSON.stringify([target.projectPath, target.sessionId, id])
    const existing = statuses.get(statusKey)
    if (existing) return existing
    const work = (async () => {
      await validateOwner(target)
      return inMediaScope(target, new AbortController().signal, async () =>
        (await import('./composer-service')).composerVideoStatus(target, id))
    })()
    statuses.set(statusKey, work)
    try { return await work } finally { statuses.delete(statusKey) }
  })
}

/** Same artifact scope and delivery as agent media tools, retaining desktop paths for the UI. */
async function inMediaScope(target: MediaComposerTarget, signal: AbortSignal, run: () => Promise<MediaComposerResult>): Promise<MediaComposerResult> {
  const remote = parseRemoteProjectKey(target.projectPath)
  const { collectArtifacts, takeArtifacts, takeHeldDeliveries, releaseHeldDeliveries } = await import('../mcp/artifact-registry')
  const callId = randomUUID()
  try {
    const result = await collectArtifacts(target.sessionId, callId, async () => {
      const result = await run()
      const { registerZoneArtifact } = await import('./zone-artifact')
      for (const file of result.files) registerZoneArtifact(file.path)
      return result
    }, remote?.connectionId)
    const held = takeHeldDeliveries(target.sessionId, callId)
    const refs = takeArtifacts(target.sessionId, callId)
    if (!remote || !refs.length) { releaseHeldDeliveries(held); return result }
    const { getEnvironmentHost } = await import('../environment/environment-host')
    const host = getEnvironmentHost()
    const zone = host.getSyncZone(remote.connectionId)
    const transfers = host.artifactTransfers
    if (!zone || !transfers) {
      releaseHeldDeliveries(held)
      // Images travel inline. Videos need a node sync zone before they can be sent to an agent.
      return result
    }
    const { syncHostActionOutputs } = await import('../environment/host-action-sync')
    const reply = await syncHostActionOutputs(target.sessionId, refs,
      new Map(held.map(handle => [handle.deliveryId, handle])),
      { content: [{ type: 'text', text: JSON.stringify(result.files.map(file => file.path)) }] },
      Date.now() + 120_000, {
        zone, connectionId: remote.connectionId, signal, transfers,
        put: input => host.artifactPut(remote.connectionId, input),
        get: input => host.artifactGet(remote.connectionId, input),
        stat: input => host.artifactStat(remote.connectionId, input.sessionId, input.relativePath),
      })
    const paths: string[] = JSON.parse(reply.content?.find(block => block.type === 'text')?.text ?? '[]')
    const sync = reply.sync as { deferred?: string[]; stopped?: string[]; retryRequired?: string[] } | undefined
    const unavailable = new Set([...(sync?.deferred ?? []), ...(sync?.stopped ?? []), ...(sync?.retryRequired ?? [])])
    return { ...result, files: result.files.map((file, i) => ({ ...file,
      agentPath: paths[i] && !unavailable.has(paths[i]) ? paths[i] : file.path })) }
  } finally {
    releaseHeldDeliveries(takeHeldDeliveries(target.sessionId, callId))
    takeArtifacts(target.sessionId, callId)
  }
}
