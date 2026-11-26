import { existsSync, readFileSync, watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import type { WebContents } from 'electron'
import {
  AgentIpcChannels,
  type SwarmBoardMember,
  type SwarmBoardMessage,
  type SwarmBoardMeta,
  type SwarmBoardPlan,
  type SwarmBoardSnapshot,
} from '@superone/shared/agent-types'
import { resolveAntigravityBrainRoots } from './antigravity-profile'
import { summarizeAntigravityTranscriptToolCall, unwrapAntigravityTranscriptArgs } from './antigravity-background-task-transcript'
import { normalizeTranscriptTool } from '@superone/shared/tool-ui'

function findSwarmDir(sessionId: string, brainRoots: string[]): string | null {
  if (!sessionId || /[/\\]/.test(sessionId)) return null
  const cleanId = sessionId.trim()
  for (const root of brainRoots) {
    const dir = join(root, cleanId, '.system_generated', 'swarm')
    if (
      existsSync(join(dir, 'swarm.json')) ||
      existsSync(join(dir, 'members.json')) ||
      existsSync(join(dir, 'board.jsonl')) ||
      existsSync(join(dir, 'plan.json'))
    ) {
      return dir
    }
  }
  return null
}

function readJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return null
  }
}

function extractMentions(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const re = /(?:^|[\s(])@([a-z0-9_-]+|all)\b/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const name = match[1]?.toLowerCase()
    if (name && !seen.has(name)) {
      seen.add(name)
      out.push(name)
    }
  }
  return out
}

function isDoneMessage(text: string): boolean {
  return /(?:^|\s)\[done\]/i.test(text)
}

function readWorkerCurrentAction(conversationId: string, brainRoots: string[]): string | undefined {
  if (!conversationId || /[/\\]/.test(conversationId)) return undefined
  for (const root of brainRoots) {
    const transcriptPath = join(root, conversationId, '.system_generated', 'logs', 'transcript.jsonl')
    if (!existsSync(transcriptPath)) continue
    try {
      const raw = readFileSync(transcriptPath, 'utf8')
      const lines = raw.trim().split('\n')
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const line = lines[i]?.trim()
        if (!line) continue
        try {
          const rec = JSON.parse(line) as Record<string, unknown>
          if (rec.type === 'PLANNER_RESPONSE') {
            const calls = Array.isArray(rec.tool_calls) ? rec.tool_calls : []
            const lastCall = calls[calls.length - 1]
            if (lastCall && typeof lastCall === 'object') {
              const tc = lastCall as Record<string, unknown>
              const rawName = typeof tc.name === 'string' ? tc.name : ''
              if (rawName === 'swarm_wait') return undefined
              const args = unwrapAntigravityTranscriptArgs(tc.args)
              const normalized = normalizeTranscriptTool(rawName, args)
              const summary = summarizeAntigravityTranscriptToolCall(normalized.toolName, normalized.input)
              return summary ? `${normalized.toolName} ${summary}` : normalized.toolName
            }
            return undefined
          }
          if (rec.type === 'GENERIC' && rec.status === 'DONE') {
            continue
          }
          break
        } catch {
          continue
        }
      }
    } catch {
      return undefined
    }
  }
  return undefined
}

export function readAntigravitySwarmBoard(
  sessionId: string,
  customBrainRoots?: string[],
): SwarmBoardSnapshot | null {
  const brainRoots = customBrainRoots ?? resolveAntigravityBrainRoots()
  const swarmDir = findSwarmDir(sessionId, brainRoots)
  if (!swarmDir) return null

  const rawSwarm = readJsonFile<Record<string, unknown>>(join(swarmDir, 'swarm.json'))
  const rawPlan = readJsonFile<SwarmBoardPlan>(join(swarmDir, 'plan.json'))
  const rawMembers = readJsonFile<{
    title?: string
    members?: Record<string, Record<string, unknown>>
  }>(join(swarmDir, 'members.json'))

  const messages: SwarmBoardMessage[] = []
  const boardPath = join(swarmDir, 'board.jsonl')
  if (existsSync(boardPath)) {
    try {
      const lines = readFileSync(boardPath, 'utf8').split('\n')
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const rec = JSON.parse(trimmed) as Record<string, unknown>
          if (typeof rec.seq !== 'number' || typeof rec.agent !== 'string' || typeof rec.text !== 'string') {
            continue
          }
          messages.push({
            seq: rec.seq,
            agent: rec.agent,
            text: rec.text,
            ...(typeof rec.time === 'string' ? { time: rec.time } : {}),
            ...(typeof rec.kind === 'string' ? { kind: rec.kind } : {}),
            ...(typeof rec.channel === 'string' ? { channel: rec.channel } : {}),
            mentions: extractMentions(rec.text),
            isDone: isDoneMessage(rec.text),
          })
        } catch {
          continue
        }
      }
    } catch {
      void 0
    }
  }

  const lastPostByAgent = new Map<string, SwarmBoardMessage>()
  for (const msg of messages) {
    lastPostByAgent.set(msg.agent, msg)
  }

  const members: SwarmBoardMember[] = []
  const rawMemberMap = rawMembers?.members ?? {}
  for (const [name, info] of Object.entries(rawMemberMap)) {
    if (!info || typeof info !== 'object') continue
    const conversationId = typeof info.conversation_id === 'string' ? info.conversation_id : ''
    const role = info.role === 'coordinator' ? 'coordinator' : 'worker'
    const killed = info.killed === true
    const wakeMode = typeof info.wake_mode === 'string' ? info.wake_mode : undefined
    const phase = typeof info.phase === 'string' ? info.phase : undefined
    const isWorking = !killed && wakeMode === 'working' && phase === 'RUNNING'
    const lastPost = lastPostByAgent.get(name)
    const currentAction = isWorking ? readWorkerCurrentAction(conversationId, brainRoots) : undefined
    const taskDescription = rawPlan?.tasks?.[name]

    members.push({
      name,
      conversationId,
      role,
      ...(typeof info.model === 'string'
        ? { model: info.model }
        : typeof info.applied_model === 'string'
          ? { model: info.applied_model }
          : {}),
      ...(phase ? { phase } : {}),
      ...(wakeMode ? { wakeMode } : {}),
      ...(typeof info.wait_since === 'number' ? { waitSince: info.wait_since } : {}),
      ...(typeof info.last_read_seq === 'number' ? { lastReadSeq: info.last_read_seq } : {}),
      killed,
      isWorking,
      ...(taskDescription ? { taskDescription } : {}),
      ...(currentAction ? { currentAction } : {}),
      ...(lastPost ? { lastPostText: lastPost.text, lastPostSeq: lastPost.seq } : {}),
    })
  }

  const headSeq = messages.reduce((max, m) => Math.max(max, m.seq), 0)
  const title =
    (typeof rawMembers?.title === 'string' && rawMembers.title.trim()) ||
    rawPlan?.goal?.title ||
    'Swarm Board'
  const isLive = members.some((m) => m.isWorking)

  const meta: SwarmBoardMeta | undefined = rawSwarm
    ? {
        ...(typeof rawSwarm.version === 'number' ? { version: rawSwarm.version } : {}),
        ...(typeof rawSwarm.backend === 'string' ? { backend: rawSwarm.backend } : {}),
        swarmId: typeof rawSwarm.swarm_id === 'string' ? rawSwarm.swarm_id : sessionId,
        ...(typeof rawSwarm.created_at === 'string' ? { createdAt: rawSwarm.created_at } : {}),
      }
    : undefined

  return {
    sessionId,
    title,
    isLive,
    ...(meta ? { meta } : {}),
    ...(rawPlan ? { plan: rawPlan } : {}),
    members,
    messages,
    headSeq,
  }
}

interface SwarmWatchEntry {
  wc: WebContents
  watchKey: string
  notifySessionId: string
  watcher: FSWatcher | null
  debounceTimer: ReturnType<typeof setTimeout> | null
}

const watchesByWc = new WeakMap<WebContents, Map<string, SwarmWatchEntry>>()

function notifySwarmWatch(entry: SwarmWatchEntry): void {
  if (entry.debounceTimer) clearTimeout(entry.debounceTimer)
  entry.debounceTimer = setTimeout(() => {
    entry.debounceTimer = null
    if (entry.wc.isDestroyed()) return
    entry.wc.send(AgentIpcChannels.SWARM_BOARD_CHANGED, entry.notifySessionId)
  }, 150)
}

function stopWatchEntry(entry: SwarmWatchEntry): void {
  if (entry.debounceTimer) {
    clearTimeout(entry.debounceTimer)
    entry.debounceTimer = null
  }
  if (entry.watcher) {
    try {
      entry.watcher.close()
    } catch {
      void 0
    }
    entry.watcher = null
  }
}

export function setSwarmBoardWatch(
  wc: WebContents,
  diskSessionId: string,
  watching: boolean,
  notifySessionId = diskSessionId,
): void {
  const watchKey = `${notifySessionId}:${diskSessionId}`
  let map = watchesByWc.get(wc)
  if (!watching) {
    const existing = map?.get(watchKey)
    if (existing) {
      stopWatchEntry(existing)
      map?.delete(watchKey)
    }
    return
  }
  if (!map) {
    map = new Map()
    watchesByWc.set(wc, map)
    wc.once('destroyed', () => {
      const entries = watchesByWc.get(wc)
      if (!entries) return
      for (const e of entries.values()) stopWatchEntry(e)
      entries.clear()
    })
  }
  if (map.has(watchKey)) return

  const swarmDir = findSwarmDir(diskSessionId, resolveAntigravityBrainRoots())
  const entry: SwarmWatchEntry = { wc, watchKey, notifySessionId, watcher: null, debounceTimer: null }
  if (swarmDir) {
    try {
      entry.watcher = watch(swarmDir, () => notifySwarmWatch(entry))
    } catch {
      entry.watcher = null
    }
  }
  map.set(watchKey, entry)
}
