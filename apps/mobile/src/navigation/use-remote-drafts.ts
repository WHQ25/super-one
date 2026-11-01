import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { Kv, RelayClient } from '@superone/relay-client'
import type { DraftChangedEvent, DraftListEntry, DraftSessionSettings } from '@superone/shared/environment/draft-rpc'
import type { ImageAttachment } from '@superone/shared/agent-types'
import type { useComposerDraft } from './use-composer-draft'
import { RemoteDraftLibrary } from '../remote-draft-library'
import { remoteDraftFromComposer } from '../remote-draft-codec'
import { randomId } from '../ids'

/**
 * An opened draft stays on the machine it was saved for. The phone's current
 * route is merged in for harness and checkout edits, but it must not retarget
 * that draft. A draft with no environment was saved for the paired desktop;
 * adopting the route would make `local` mean the node the phone is on now.
 * A new draft still records the current route.
 */
export function settingsKeepingSavedEnvironment(
  saved: DraftSessionSettings | undefined,
  incoming: DraftSessionSettings,
): DraftSessionSettings {
  if (!saved) return incoming
  const merged: DraftSessionSettings = { ...saved, ...incoming }
  if (saved.environmentId) merged.environmentId = saved.environmentId
  else delete merged.environmentId
  return merged
}

export function useRemoteDrafts(opts: {
  kv: Kv; pairingId: string | null; clientRef: RefObject<RelayClient | null>
  composer: ReturnType<typeof useComposerDraft>; attachments: ImageAttachment[]
  projectPath?: string; sessionId: string | null; settings: DraftSessionSettings
  apply(draft: DraftListEntry): Promise<void>
  onError(message: string): void
  onRevoked(): void
}) {
  const [, update] = useState(0)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  const active = useRef<string | null>(null)
  const saved = useRef<DraftListEntry | null>(null)
  const suspended = useRef(false)
  const current = useRef(opts)
  current.current = opts
  const error = (cause: unknown) => current.current.onError(cause instanceof Error ? cause.message : String(cause))
  const library = useMemo(() => new RemoteDraftLibrary({
    kv: opts.kv, key: `composer.drafts.${opts.pairingId ?? 'none'}`,
    rpc: (method, payload) => {
      if (current.current.pairingId !== opts.pairingId) throw new Error('The connected desktop changed. Draft remains saved on this phone.')
      const client = current.current.clientRef.current
      if (!client) throw new Error('Draft saved on this phone. Connect to synchronize it.')
      return client.rpc(method, payload)
    },
    changed: () => update((n) => n + 1),
    revoked: (id) => {
      if (active.current !== id) return
      active.current = null; saved.current = null; setActiveId(null)
      suspended.current = true
      current.current.onRevoked()
      suspended.current = false
    },
  }), [opts.kv, opts.pairingId])
  const lastSignature = useRef('')
  // Set when the composer is parked without being replaced. The next edit
  // continues that draft; a replaced composer (new session) mints a new id.
  const resumeId = useRef<string | null>(null)
  const resumeGeneration = useRef<number | null>(null)
  const boot = useRef(Promise.resolve())
  const stage = () => {
    const o = current.current
    if (suspended.current || o.sessionId || !o.pairingId || !o.projectPath) return null
    const snapshot = { ...o.composer.exportSnapshot(), attachments: o.attachments }
    if (!active.current && !snapshot.text.trim() && !snapshot.attachments.length) return null
    if (!active.current) {
      const resume = resumeId.current != null && resumeGeneration.current === o.composer.generation
      const id = resume ? resumeId.current! : (library.composerDraftId() ?? randomId())
      if (!resume) resumeId.current = null
      active.current = id
      saved.current = library.get(id) ?? saved.current
      setActiveId(id)
      library.claimComposer(id)
    }
    const id = active.current
    const known = library.get(id)
    if (known) saved.current = known
    const input = remoteDraftFromComposer(id, o.projectPath, snapshot, settingsKeepingSavedEnvironment(saved.current?.settings, o.settings), saved.current?.originSessionId)
    if (saved.current) input.createdAt = saved.current.createdAt
    const signature = JSON.stringify(input)
    if (lastSignature.current !== signature) {
      lastSignature.current = signature
      void library.stage(input).catch(error)
    }
    return id
  }
  // Includes document identities: two native chip documents may have identical
  // visible object characters but refer to different files or sessions.
  const signature = JSON.stringify([opts.composer.exportSnapshot(), opts.attachments, opts.settings, opts.projectPath, opts.sessionId])
  useEffect(() => {
    let cancelled = false
    const run = (async () => {
      await library.ready
      if (cancelled) return
      // This library is a different desktop, or a fresh mount. Drop the previous
      // composer's id before refresh decides whether the open text still owns one.
      active.current = null
      saved.current = null
      resumeId.current = null
      resumeGeneration.current = null
      setActiveId(null)
      lastSignature.current = ''
      const o = current.current
      const snapshot = o.composer.exportSnapshot()
      const empty = !snapshot.text.trim() && o.attachments.length === 0
      // A cold start has an empty composer. Forget the claim so the next note
      // does not overwrite the draft left in the list. A reload that kept the
      // text is still that draft.
      if (empty) library.releaseComposer()
      if (!cancelled && o.pairingId) await library.refresh().catch(error)
      if (cancelled) return
      const remembered = empty ? null : library.composerDraftId()
      if (!remembered) return
      active.current = remembered
      saved.current = library.get(remembered) ?? null
      setActiveId(remembered)
      lastSignature.current = ''
    })()
    boot.current = run.then(() => {})
    return () => { cancelled = true }
  }, [library])
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    void boot.current.then(() => {
      if (cancelled) return
      const id = stage()
      if (!id) return
      timer = setTimeout(() => { void library.flush(id).catch(error) }, 450)
    })
    return () => { cancelled = true; clearTimeout(timer) }
  }, [signature, library, activeId])

  const park = async () => {
    await library.ready
    const id = stage() ?? active.current
    resumeId.current = id
    resumeGeneration.current = current.current.composer.generation
    active.current = null; saved.current = null; setActiveId(null); lastSignature.current = ''
    suspended.current = true
    if (id) library.releaseComposer(id)
    if (id) await library.close(id).catch(error)
  }
  return {
    activeId, opening, rows: library.rows,
    settings: saved.current?.settings,
    originSessionId: saved.current?.originSessionId,
    prepareSend: async () => {
      const id = stage() ?? active.current
      return id ? library.prepareSend(id) : {}
    },
    park,
    begin: () => { suspended.current = false; lastSignature.current = '' },
    open: async (row: DraftListEntry) => {
      setOpening(true)
      let openedId: string | null = null
      try {
        await park()
        const draft = await library.open(row.id)
        openedId = draft.id
        await current.current.apply(draft)
        saved.current = draft; active.current = draft.id; setActiveId(draft.id)
        resumeId.current = null
        library.claimComposer(draft.id)
        lastSignature.current = ''
      } catch (error) {
        if (openedId) await library.close(openedId).catch(() => {})
        throw error
      } finally { suspended.current = false; setOpening(false) }
    },
    consume: async () => {
      const id = active.current
      resumeId.current = null
      active.current = null; saved.current = null; setActiveId(null); lastSignature.current = ''
      if (id) library.releaseComposer(id)
      if (id) await library.remove(id).catch(error)
    },
    remove: async (row: DraftListEntry) => { await library.remove(row.id); if (active.current === row.id) current.current.onRevoked() },
    ingest: (events: readonly unknown[]) => {
      for (const event of events) if ((event as { type?: string }).type === 'draft_changed') library.ingest(event as DraftChangedEvent)
    },
    ingestSnapshot: (drafts: DraftListEntry[]) => library.ingestSnapshot(drafts),
    reconnect: async () => {
      await library.reconnect(active.current)
    },
    refresh: () => library.refresh(),
  }
}
