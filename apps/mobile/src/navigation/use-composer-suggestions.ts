import type { RelayClient } from '@superone/relay-client'
import { requestMentionSearch } from '../mention-search'
import { useEffect, useRef, useState, type RefObject } from 'react'
import type { ChatRuntime } from '../runtime'
import { cursorAfterEdit, type ComposerCursor } from '../composer-cursor'
import { mergeMentionItems } from '../composer-state'
import { extractMentionQuery, insertMention, parseMentionItems, parseAgentMentionItems, type MentionItem } from '../mentions'
import { filterSlashCommands, type SlashCommandMatch } from '../slash'

export type MentionSearchState = { active: boolean; loading: boolean; error?: string }
const CLOSED: MentionSearchState = { active: false, loading: false }

export function useComposerSuggestions(runtimeRef: RefObject<ChatRuntime | null>, contextKey: string, idle?: { client: RefObject<RelayClient | null>; projectPath?: string }) {
  const [slashHits, setSlashHits] = useState<SlashCommandMatch[]>([])
  const [mentionHits, setMentionHits] = useState<MentionItem[]>([])
  const [mentionSearch, setMentionSearch] = useState<MentionSearchState>(CLOSED)
  const [requestedCursor, setRequestedCursor] = useState<ComposerCursor>()
  const text = useRef('')
  const cursor = useRef<ComposerCursor>({ start: 0, end: 0 })
  const generation = useRef(0)
  const catalog = useRef<{ agentTargets?: unknown; capabilityIds?: unknown }>({})

  const clear = () => {
    generation.current++
    setSlashHits([])
    setMentionHits([])
    setMentionSearch(CLOSED)
  }
  useEffect(() => {
    catalog.current = {}
    clear()
    return () => { generation.current++ }
  }, [contextKey])

  const search = () => {
    const request = ++generation.current
    const runtime = runtimeRef.current
    const client = idle?.client.current
    const projectPath = idle?.projectPath
    const collapsed = cursor.current.start === cursor.current.end
    setSlashHits(collapsed && cursor.current.end === text.current.length
      ? filterSlashCommands(text.current, runtime?.slashCommands ?? []) : [])
    const query = collapsed ? extractMentionQuery(text.current, cursor.current.end) : null
    if (!query) {
      setMentionHits([])
      setMentionSearch(CLOSED)
      return
    }
    const lookup = runtime ? () => runtime.searchMentions(query.query)
      : client && projectPath ? () => requestMentionSearch(client, projectPath, query.query) : null
    setMentionHits(mergeMentionItems(query.query, parseAgentMentionItems(catalog.current.agentTargets, query.query), catalog.current.capabilityIds))
    setMentionSearch({ active: true, loading: !!lookup })
    if (!lookup) return
    void Promise.resolve().then(lookup).then((result) => {
      if (request !== generation.current || runtime !== runtimeRef.current || (!runtime && client !== idle?.client.current)) return
      if (result.error) throw new Error(result.error)
      catalog.current = { agentTargets: result.agentTargets, capabilityIds: result.capabilityIds }
      setMentionHits(mergeMentionItems(query.query, [...parseAgentMentionItems(result.agentTargets, query.query), ...parseMentionItems(result.items)], result.capabilityIds))
      setMentionSearch({ active: true, loading: false })
    }).catch((error: unknown) => {
      if (request !== generation.current || runtime !== runtimeRef.current || (!runtime && client !== idle?.client.current)) return
      setMentionSearch({ active: true, loading: false, error: error instanceof Error ? error.message : 'Could not load mention suggestions' })
    })
  }
  const update = (value: string) => {
    cursor.current = cursorAfterEdit(text.current, value, cursor.current)
    text.current = value
    setRequestedCursor(undefined)
    search()
  }
  const updateNative = (value: string, selection: ComposerCursor, composing: boolean) => {
    text.current = value
    cursor.current = selection
    setRequestedCursor(undefined)
    if (composing) clear()
    else search()
  }
  const select = (selection: ComposerCursor) => {
    if (selection.start < 0 || selection.end > text.current.length) return
    // Programmatic selection is one-shot; subsequent native cursor movement and
    // IME composition must remain uncontrolled.
    setRequestedCursor(undefined)
    if (selection.start === cursor.current.start && selection.end === cursor.current.end) return
    cursor.current = selection
    search()
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
    clear()
    return value
  }
  return { slashHits, mentionHits, mentionSearch, requestedCursor, update, updateNative, select, insert, clear, retry: search }
}
