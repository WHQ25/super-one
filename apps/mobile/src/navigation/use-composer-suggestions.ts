import type { RelayClient } from '@superone/relay-client'
import { requestMentionSearch } from '../mention-search'
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { ChatRuntime } from '../runtime'
import { cursorAfterEdit, type ComposerCursor } from '../composer-cursor'
import { mergeMentionItems } from '../composer-state'
import { extractMentionQuery, insertMention, parseMentionItems, parseAgentMentionItems, type MentionItem } from '../mentions'
import { filterSlashCommands, type SlashCommandInfo } from '../slash'
import { requestSlashCatalog, type SlashCatalogStatus } from '../slash-catalog'

export type MentionSearchState = { active: boolean; loading: boolean; error?: string }
const CLOSED: MentionSearchState = { active: false, loading: false }

/**
 * Where the composer's suggestions come from.
 *
 * The command catalog hangs off the project and harness, not off a session, so
 * the new-session landing gets the same overlay a live chat does. `runtimeRef`
 * still gates mention search, which needs the session's resolved cwd.
 */
export interface ComposerSuggestionSource {
  client: RefObject<RelayClient | null>
  projectPath?: string
  provider?: string
}

export function useComposerSuggestions(
  runtimeRef: RefObject<ChatRuntime | null>,
  contextKey: string,
  host: ComposerSuggestionSource,
) {
  const [draft, setDraft] = useState('')
  const [slashDismissed, setSlashDismissed] = useState(false)
  const [catalog, setCatalog] = useState<SlashCommandInfo[]>([])
  const [catalogStatus, setCatalogStatus] = useState<SlashCatalogStatus>('loading')
  const [mentionHits, setMentionHits] = useState<MentionItem[]>([])
  const [mentionSearch, setMentionSearch] = useState<MentionSearchState>(CLOSED)
  const [requestedCursor, setRequestedCursor] = useState<ComposerCursor>()
  const text = useRef('')
  const cursor = useRef<ComposerCursor>({ start: 0, end: 0 })
  const generation = useRef(0)
  const catalogGeneration = useRef(0)
  const mentionCatalog = useRef<{ agentTargets?: unknown; capabilityIds?: unknown }>({})

  const clear = () => {
    generation.current++
    setMentionHits([])
    setMentionSearch(CLOSED)
  }
  useEffect(() => {
    mentionCatalog.current = {}
    clear()
    return () => { generation.current++ }
  }, [contextKey])

  // Catalog load is keyed on the same context as everything else, so switching
  // project, harness or device refetches rather than showing the last one's
  // commands.
  const { projectPath, provider } = host
  useEffect(() => {
    const request = ++catalogGeneration.current
    const client = host.client.current
    if (!client || !projectPath || !provider) {
      setCatalog([])
      setCatalogStatus('ready')
      return
    }
    setCatalog([])
    setCatalogStatus('loading')
    void requestSlashCatalog(client, projectPath, provider).then((commands) => {
      if (request !== catalogGeneration.current) return
      setCatalog(commands)
      setCatalogStatus('ready')
    }).catch(() => {
      if (request !== catalogGeneration.current) return
      setCatalog([])
      setCatalogStatus('error')
    })
    return () => { catalogGeneration.current++ }
    // `contextKey` also covers the connected device, which the two values below
    // cannot express on their own.
  }, [contextKey, projectPath, provider])

  /**
   * Derived rather than stored, so a catalog that lands *after* the user typed
   * `/` still opens the overlay. The old code only recomputed on keystrokes and
   * silently showed nothing until the next one.
   */
  const slashHits = useMemo(
    () => (slashDismissed ? [] : filterSlashCommands(draft, catalog, provider)),
    [draft, catalog, provider, slashDismissed],
  )

  const searchMentions = () => {
    const request = ++generation.current
    const runtime = runtimeRef.current
    const client = host.client.current
    const collapsed = cursor.current.start === cursor.current.end
    const query = collapsed ? extractMentionQuery(text.current, cursor.current.end) : null
    if (!query) {
      setMentionHits([])
      setMentionSearch(CLOSED)
      return
    }
    const lookup = runtime ? () => runtime.searchMentions(query.query)
      : client && projectPath ? () => requestMentionSearch(client, projectPath, query.query) : null
    setMentionHits(mergeMentionItems(query.query, parseAgentMentionItems(mentionCatalog.current.agentTargets, query.query), mentionCatalog.current.capabilityIds))
    setMentionSearch({ active: true, loading: !!lookup })
    if (!lookup) return
    void Promise.resolve().then(lookup).then((result) => {
      if (request !== generation.current || runtime !== runtimeRef.current || (!runtime && client !== host.client.current)) return
      if (result.error) throw new Error(result.error)
      mentionCatalog.current = { agentTargets: result.agentTargets, capabilityIds: result.capabilityIds }
      setMentionHits(mergeMentionItems(query.query, [...parseAgentMentionItems(result.agentTargets, query.query), ...parseMentionItems(result.items)], result.capabilityIds))
      setMentionSearch({ active: true, loading: false })
    }).catch((error: unknown) => {
      if (request !== generation.current || runtime !== runtimeRef.current || (!runtime && client !== host.client.current)) return
      setMentionSearch({ active: true, loading: false, error: error instanceof Error ? error.message : 'Could not load mention suggestions' })
    })
  }

  /** Any edit the user made re-arms a dismissed overlay; a programmatic one does not. */
  const observe = (value: string, composing: boolean) => {
    setDraft(value)
    setSlashDismissed(false)
    setRequestedCursor(undefined)
    if (composing) clear()
    else searchMentions()
  }

  const update = (value: string) => {
    cursor.current = cursorAfterEdit(text.current, value, cursor.current)
    text.current = value
    observe(value, false)
  }
  const updateNative = (value: string, selection: ComposerCursor, composing: boolean) => {
    text.current = value
    cursor.current = selection
    observe(value, composing)
  }
  const select = (selection: ComposerCursor) => {
    if (selection.start < 0 || selection.end > text.current.length) return
    // Programmatic selection is one-shot; subsequent native cursor movement and
    // IME composition must remain uncontrolled.
    setRequestedCursor(undefined)
    if (selection.start === cursor.current.start && selection.end === cursor.current.end) return
    cursor.current = selection
    searchMentions()
  }
  const insert = (item: MentionItem): string | undefined => {
    if (cursor.current.start !== cursor.current.end) return
    const query = extractMentionQuery(text.current, cursor.current.end)
    if (!query) return
    const value = insertMention(text.current, query, item)
    const end = cursor.current.end + value.length - text.current.length
    text.current = value
    cursor.current = { start: end, end }
    setRequestedCursor(cursor.current)
    setDraft(value)
    clear()
    return value
  }
  /** Record a draft the app rewrote, without re-arming the slash overlay. */
  const applyProgrammatic = (value: string) => {
    text.current = value
    setDraft(value)
    setSlashDismissed(true)
    clear()
  }
  return {
    slashHits, slashCatalogStatus: catalogStatus, mentionHits, mentionSearch, requestedCursor,
    update, updateNative, select, insert, clear, applyProgrammatic,
    dismissSlash: () => setSlashDismissed(true),
    retry: searchMentions,
  }
}
