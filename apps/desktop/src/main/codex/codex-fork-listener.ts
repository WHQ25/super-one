import log from '../logger'
import { trace } from '../agent/event-trace'
import { asRecord, readString, type AppServerConnection, type AppServerNotification } from './app-server-connection'
import type { NotificationInbox } from './codex-notification-dispatcher'
import type { CodexSession } from './codex-session'
import {
  buildReasoningItem,
  mapThreadItemFromAppServer,
  mapUsageFromTokenUsage,
  processServerRequest,
  readDeltaText,
  readItemId,
  tokenSnapshotFromUsage,
  type CodexRunStreamCallbacks,
} from './codex-turn'
import type {
  CodexCollabAgentStatus,
  CodexCollabToolCallItem,
  CodexThreadItem,
} from '@superone/shared/agent-types'

export interface ForkListenerHandle {
  readonly forkThreadId: string
  readonly collabId: string
  attachCollab(collab: CodexCollabToolCallItem): void
  stop(reason?: string): void
  readonly done: Promise<void>
}

export interface ForkListenerOptions {
  forkThreadId: string
  collab: CodexCollabToolCallItem
  inbox: NotificationInbox
  connection: AppServerConnection
  session: CodexSession
  callbacks: CodexRunStreamCallbacks
  onClose?: (reason: string) => void
}

interface CollabSlot {
  collab: CodexCollabToolCallItem
  order: string[]
  map: Map<string, CodexThreadItem>
}

export function startForkListener(opts: ForkListenerOptions): ForkListenerHandle {
  const { forkThreadId, inbox, connection, callbacks } = opts
  let stopped = false
  let stopReason: string | null = null

  const slots = new Map<string, CollabSlot>()
  let currentCollabId = opts.collab.id

  const forkedFromId = opts.collab.agentsStates[forkThreadId]?.forkedFromId ?? null
  const nickname = opts.collab.agentsStates[forkThreadId]?.nickname
  const role = opts.collab.agentsStates[forkThreadId]?.role

  const makeSlot = (collab: CodexCollabToolCallItem): CollabSlot => {
    const cloned = cloneCollab(collab)
    if (forkedFromId || nickname || role) {
      const prev = cloned.agentsStates[forkThreadId] ?? { status: 'pendingInit' as CodexCollabAgentStatus }
      cloned.agentsStates[forkThreadId] = {
        ...prev,
        ...(forkedFromId ? { forkedFromId } : {}),
        ...(nickname ? { nickname } : {}),
        ...(role ? { role } : {}),
      }
    }
    const slot: CollabSlot = { collab: cloned, order: [], map: new Map() }
    for (const existing of collab.childItems?.[forkThreadId] ?? []) {
      slot.order.push(existing.id)
      slot.map.set(existing.id, existing)
    }
    return slot
  }

  slots.set(opts.collab.id, makeSlot(opts.collab))

  const currentSlot = (): CollabSlot => {
    let slot = slots.get(currentCollabId)
    if (!slot) {
      slot = { collab: cloneCollab({ ...opts.collab, id: currentCollabId, childItems: undefined }), order: [], map: new Map() }
      slots.set(currentCollabId, slot)
    }
    return slot
  }

  const upsertChild = (item: CodexThreadItem): void => {
    const slot = currentSlot()
    if (!slot.map.has(item.id)) slot.order.push(item.id)
    slot.map.set(item.id, item)
  }

  const emitCollabUpdate = (trigger: string): void => {
    const slot = currentSlot()
    const items = slot.order
      .map((id) => slot.map.get(id))
      .filter((it): it is CodexThreadItem => Boolean(it))
    const nextChildItems: Record<string, CodexThreadItem[]> = {
      ...(slot.collab.childItems ?? {}),
      [forkThreadId]: items,
    }
    slot.collab = { ...slot.collab, childItems: nextChildItems }
    if (process.env.NODE_ENV === 'development') {
      trace('codex.fork', 'emit_update', {
        collabId: slot.collab.id,
        forkThreadId,
        trigger,
        childCount: items.length,
        agentStatus: slot.collab.agentsStates[forkThreadId]?.status,
      }, slot.collab.id)
    }
    if (callbacks.emitForkItem) callbacks.emitForkItem(forkThreadId, 'updated', slot.collab)
    else callbacks.onItemDelta?.('updated', slot.collab)
  }

  const mutateAgentState = (mutator: (prev: { status: CodexCollabAgentStatus; tokens?: { input: number; output: number } }) => Partial<{ status: CodexCollabAgentStatus; tokens: { input: number; output: number } }>): boolean => {
    const slot = currentSlot()
    const prev = slot.collab.agentsStates[forkThreadId] ?? { status: 'pendingInit' as CodexCollabAgentStatus }
    const patch = mutator(prev)
    if (!patch || Object.keys(patch).length === 0) return false
    slot.collab = {
      ...slot.collab,
      agentsStates: { ...slot.collab.agentsStates, [forkThreadId]: { ...prev, ...patch } },
    }
    return true
  }

  const setAgentStatus = (status: CodexCollabAgentStatus): void => {
    const changed = mutateAgentState((prev) => prev.status === status ? {} : { status })
    if (changed) emitCollabUpdate(`agent:${status}`)
  }

  const applyTokenUsage = (raw: unknown): void => {
    const usage = mapUsageFromTokenUsage(raw)
    if (!usage) return
    const tokens = tokenSnapshotFromUsage(usage)
    const changed = mutateAgentState((prev) =>
      prev.tokens?.input === tokens.input && prev.tokens?.output === tokens.output
        ? {}
        : { tokens },
    )
    if (changed) emitCollabUpdate('tokenUsage')
  }

  const handleNotification = (notif: AppServerNotification): void => {
    const { method, params } = notif
    const slot = currentSlot()

    if (process.env.NODE_ENV === 'development') {
      trace('codex.fork', method, {
        collabId: slot.collab.id,
        forkThreadId,
        itemId: readItemId(params),
        itemType: readString(asRecord(params.item)?.type),
      }, slot.collab.id)
    }

    switch (method) {
      case 'item/started':
      case 'item/completed': {
        const rawItem = asRecord(params.item)
        if (!rawItem) return
        const itemId = readString(rawItem.id)
        const previous = itemId ? slot.map.get(itemId) : undefined
        if (previous?.type === 'plan' && method === 'item/completed') {
          emitCollabUpdate(`fork:${method}:plan`)
          return
        }
        const mapped = mapThreadItemFromAppServer(rawItem, previous)
        if (!mapped) return
        upsertChild(mapped)
        emitCollabUpdate(`fork:${method}:${mapped.type}`)
        return
      }

      case 'item/agentMessage/delta': {
        const itemId = readString(params.itemId)
        const delta = readString(params.delta) ?? ''
        if (!itemId) return
        const prev = slot.map.get(itemId)
        const prevText = prev?.type === 'agent_message' ? prev.text : ''
        upsertChild({ id: itemId, type: 'agent_message', text: `${prevText}${delta}` })
        emitCollabUpdate('fork:agentMessage/delta')
        return
      }

      case 'item/reasoning/summaryTextDelta':
      case 'item/reasoning/summary_text_delta':
      case 'item/reasoning/summaryDelta':
      case 'item/reasoning/summary_delta':
      case 'item/reasoning/summaryPartAdded':
      case 'item/reasoning/summary_part_added':
      case 'item/reasoning/textDelta':
      case 'item/reasoning/text_delta':
      case 'item/reasoning/delta': {
        const itemId = readItemId(params)
        const delta = readDeltaText(params)
        if (!itemId) return
        const prev = slot.map.get(itemId)
        const prevText = prev?.type === 'reasoning' ? prev.text : ''
        const nextText =
          method === 'item/reasoning/summaryPartAdded' || method === 'item/reasoning/summary_part_added'
            ? (prevText && !prevText.endsWith('\n\n') ? `${prevText}\n\n` : prevText)
            : `${prevText}${delta}`
        upsertChild(buildReasoningItem(itemId, nextText, prev))
        emitCollabUpdate('fork:reasoning/delta')
        return
      }

      case 'item/commandExecution/outputDelta': {
        const itemId = readString(params.itemId)
        const delta = readString(params.delta) ?? ''
        if (!itemId) return
        const prev = slot.map.get(itemId)
        const prevCmd = prev?.type === 'command_execution' ? prev : null
        upsertChild({
          id: itemId,
          type: 'command_execution',
          command: prevCmd?.command ?? '',
          aggregatedOutput: `${prevCmd?.aggregatedOutput ?? ''}${delta}`,
          ...(prevCmd?.exitCode !== undefined ? { exitCode: prevCmd.exitCode } : {}),
          status: prevCmd?.status ?? 'in_progress',
          ...(prevCmd?.commandActions ? { commandActions: prevCmd.commandActions } : {}),
        })
        emitCollabUpdate('fork:commandExecution/outputDelta')
        return
      }

      case 'turn/started':
        setAgentStatus('running')
        return

      case 'turn/completed':
        setAgentStatus('completed')
        return

      case 'thread/tokenUsage/updated':
        applyTokenUsage(params.tokenUsage ?? params)
        return

      default:
        return
    }
  }

  const attachCollab = (newCollab: CodexCollabToolCallItem): void => {
    if (newCollab.id === currentCollabId) return
    const prevCollabId = currentCollabId
    if (!slots.has(newCollab.id)) slots.set(newCollab.id, makeSlot(newCollab))
    currentCollabId = newCollab.id
    if (prevCollabId !== newCollab.id) slots.delete(prevCollabId)
    if (process.env.NODE_ENV === 'development') {
      trace('codex.fork', 'attach_collab', { forkThreadId, collabId: newCollab.id, tool: newCollab.tool }, newCollab.id)
    }
    emitCollabUpdate('attach')
  }

  const done = (async () => {
    while (!stopped) {
      let notif: AppServerNotification
      try {
        notif = await inbox.next()
      } catch (err) {
        if (!stopped) {
          stopReason = err instanceof Error ? err.message : String(err)
          log.info('[codex] fork listener inbox closed: %s thread=%s', stopReason, forkThreadId)
        }
        break
      }
      if (stopped) break
      if (notif.requestIdRaw !== undefined) {
        try {
          await processServerRequest(notif, connection, opts.session, callbacks)
        } catch (err) {
          log.warn('[codex] fork listener server-request error: %s', err instanceof Error ? err.message : String(err))
        }
        continue
      }
      try {
        handleNotification(notif)
      } catch (err) {
        log.warn('[codex] fork listener handler error: %s', err instanceof Error ? err.message : String(err))
      }
    }
    if (process.env.NODE_ENV === 'development') {
      trace('codex.fork', 'closed', { collabId: opts.collab.id, forkThreadId, reason: stopReason ?? 'stop' }, opts.collab.id)
    }
    opts.onClose?.(stopReason ?? 'stop')
  })()

  return {
    forkThreadId,
    collabId: opts.collab.id,
    attachCollab,
    stop: (reason) => {
      if (stopped) return
      stopped = true
      stopReason = reason ?? 'stop'
    },
    done,
  }
}

export function cloneCollab(collab: CodexCollabToolCallItem): CodexCollabToolCallItem {
  return {
    ...collab,
    agentsStates: { ...collab.agentsStates },
    receiverThreadIds: [...collab.receiverThreadIds],
    childItems: collab.childItems ? { ...collab.childItems } : undefined,
  }
}
