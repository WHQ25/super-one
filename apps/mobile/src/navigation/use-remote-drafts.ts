import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { Kv, RelayClient } from '@superone/relay-client'
import type { DraftChangedEvent, DraftListEntry, DraftSessionSettings } from '@superone/shared/environment/draft-rpc'
import type { ImageAttachment } from '@superone/shared/agent-types'
import type { useComposerDraft } from './use-composer-draft'
import { RemoteDraftLibrary } from '../remote-draft-library'
import { remoteDraftFromComposer } from '../remote-draft-codec'
import { randomId } from '../ids'

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
    request: (command) => {
      if (current.current.pairingId !== opts.pairingId) throw new Error('The connected desktop changed. Draft remains saved on this phone.')
      const client = current.current.clientRef.current
      if (!client) throw new Error('Draft saved on this phone. Connect to synchronize it.')
      return client.request(command)
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
  const stage = () => {
    const o = current.current
    if (suspended.current || o.sessionId || !o.pairingId || !o.projectPath) return null
    const snapshot = { ...o.composer.exportSnapshot(), attachments: o.attachments }
    if (!active.current && !snapshot.text.trim() && !snapshot.attachments.length) return null
    const id = active.current ?? randomId()
    if (!active.current) { active.current = id; setActiveId(id) }
    const input = remoteDraftFromComposer(id, o.projectPath, snapshot, { ...saved.current?.settings, ...o.settings }, saved.current?.originSessionId)
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
    active.current = null; saved.current = null; setActiveId(null); lastSignature.current = ''
    if (opts.pairingId) void library.refresh().catch(error)
  }, [library])
  useEffect(() => {
    const id = stage()
    if (!id) return
    const timer = setTimeout(() => { void library.flush(id).catch(error) }, 450)
    return () => clearTimeout(timer)
  }, [signature, library, activeId])

  const park = async () => {
    const id = stage() ?? active.current
    active.current = null; saved.current = null; setActiveId(null); lastSignature.current = ''
    suspended.current = true
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
        lastSignature.current = ''
      } catch (error) {
        if (openedId) await library.close(openedId).catch(() => {})
        throw error
      } finally { suspended.current = false; setOpening(false) }
    },
    consume: async () => {
      const id = active.current
      active.current = null; saved.current = null; setActiveId(null); lastSignature.current = ''
      if (id) await library.remove(id).catch(error)
    },
    remove: async (row: DraftListEntry) => { await library.remove(row.id); if (active.current === row.id) current.current.onRevoked() },
    ingest: (events: readonly unknown[]) => {
      for (const event of events) if ((event as { type?: string }).type === 'draft_changed') library.ingest(event as DraftChangedEvent)
    },
    reconnect: async () => {
      await library.reconnect(active.current)
      await library.refresh()
    },
    refresh: () => library.refresh(),
  }
}
