import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentEvent, WorkflowAgentRow, WorkflowPhaseRow } from '@superone/shared/agent-types'
import {
  normalizeWorkflowAgentState,
  parseAntigravityWorkflowLog,
} from '@superone/chat-view/presenters/workflow-utils'
import {
  deriveAntigravityBrainRootFromLogPath,
  summarizeAntigravityAgentTranscript,
} from '../antigravity-workflow-transcripts'
import { resolveAntigravityBrainRoots } from './antigravity-profile'

export interface AntigravityWorkflowLiveSnapshot {
  signature: string
  workflowPhases: WorkflowPhaseRow[]
  workflowAgents: WorkflowAgentRow[]
  currentPhase?: string
  totalTokens: number
  toolUses: number
  resultText?: string
}

export interface TrackedWorkflowTaskHandle {
  toolUseId: string
  toolName: string
  taskId?: string
  description: string
  logFile?: string
  startedAtMs: number
  emittedTaskStarted: boolean
  completed: boolean
  lastWorkflowProgressSignature?: string
}

function readTextSafe(filePath: string | undefined): string {
  if (!filePath) return ''
  try {
    return readFileSync(filePath, 'utf8')
  } catch {
    return ''
  }
}

function childTranscriptHasFinished(raw: string): boolean {
  let pendingFinish = false
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let rec: Record<string, unknown>
    try {
      rec = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      continue
    }
    if (rec.type === 'PLANNER_RESPONSE') {
      const calls = Array.isArray(rec.tool_calls) ? rec.tool_calls : []
      pendingFinish = calls.some(
        (tc) => tc && typeof tc === 'object' && (tc as { name?: unknown }).name === 'finish',
      )
      continue
    }
    if (rec.type === 'GENERIC' && pendingFinish) {
      if (rec.status === 'DONE') return true
      pendingFinish = false
    }
  }
  return false
}

function findChildTranscriptRaw(agentId: string, brainRoots: readonly string[]): string | null {
  if (!agentId || agentId.includes('/') || agentId.includes('\\') || agentId.includes('..')) {
    return null
  }
  for (const root of brainRoots) {
    for (const filename of ['transcript.jsonl', 'transcript_full.jsonl']) {
      const candidate = join(root, agentId, '.system_generated', 'logs', filename)
      if (!existsSync(candidate)) continue
      try {
        return readFileSync(candidate, 'utf8')
      } catch {
        return null
      }
    }
  }
  return null
}

function buildPhaseRows(
  titles: string[],
  finalStatus?: 'completed' | 'failed' | 'stopped',
): WorkflowPhaseRow[] {
  if (titles.length === 0) return []
  return titles.map((title, idx) => {
    if (finalStatus === 'completed') {
      return { title, state: 'done' }
    }
    if (finalStatus === 'failed' || finalStatus === 'stopped') {
      return { title, ...(idx < titles.length - 1 ? { state: 'done' } : {}) }
    }
    return {
      title,
      state: idx < titles.length - 1 ? 'done' : 'active',
    }
  })
}

export function readAntigravityWorkflowSnapshot(opts: {
  logFile?: string
  fallbackText?: string
  brainRoots?: string[]
  finalStatus?: 'completed' | 'failed' | 'stopped'
}): AntigravityWorkflowLiveSnapshot | null {
  const logRaw = readTextSafe(opts.logFile)
  const parsedLog = logRaw ? parseAntigravityWorkflowLog(logRaw) : null
  const parsedFallback = !parsedLog && opts.fallbackText
    ? parseAntigravityWorkflowLog(opts.fallbackText)
    : null
  const parsed = parsedLog ?? parsedFallback
  if (!parsed) return null

  const derivedRoot = deriveAntigravityBrainRootFromLogPath(opts.logFile)
  const roots = [...new Set([
    ...(derivedRoot ? [derivedRoot] : []),
    ...(opts.brainRoots ?? resolveAntigravityBrainRoots()),
  ])]

  const workflowAgents: WorkflowAgentRow[] = []
  let totalTokens = 0
  let toolUses = 0

  for (const agent of parsed.agents) {
    const childRaw = findChildTranscriptRaw(agent.agentId, roots)
    const childSummary = childRaw ? summarizeAntigravityAgentTranscript(childRaw) : null
    const toolCount = agent.toolCount || childSummary?.toolCount || 0
    const tokens = agent.tokens ?? childSummary?.tokens
    let state = agent.state
    const norm = normalizeWorkflowAgentState(state)
    if (!norm || norm === 'running') {
      if (childRaw && childTranscriptHasFinished(childRaw)) {
        state = 'done'
      } else if (!state) {
        state = opts.finalStatus === 'completed' ? 'done' : 'running'
      }
    }
    toolUses += toolCount
    if (tokens) totalTokens += tokens
    workflowAgents.push({
      agentId: agent.agentId,
      label: agent.label,
      toolCount,
      ...(tokens !== undefined ? { tokens } : {}),
      ...(state ? { state } : {}),
      ...(agent.phase ? { phase: agent.phase } : {}),
    })
  }

  const phaseTitles = parsed.phases.map((p) => p.title)
  const currentPhase = phaseTitles.length > 0 ? phaseTitles[phaseTitles.length - 1] : undefined
  const workflowPhases = buildPhaseRows(phaseTitles, opts.finalStatus)
  const resultText = parsed.resultText

  const signature = JSON.stringify([
    currentPhase ?? '',
    workflowPhases,
    workflowAgents,
    totalTokens,
    toolUses,
    resultText ?? '',
  ])

  return {
    signature,
    workflowPhases,
    workflowAgents,
    ...(currentPhase ? { currentPhase } : {}),
    totalTokens,
    toolUses,
    ...(resultText ? { resultText } : {}),
  }
}

export function buildWorkflowProgressEvent(
  entry: {
    toolUseId: string
    taskId: string
    description: string
    logFile?: string
    startedAtMs: number
  },
  snapshot: AntigravityWorkflowLiveSnapshot,
  now = Date.now(),
): AgentEvent {
  return {
    type: 'task_progress',
    toolUseId: entry.toolUseId,
    taskId: entry.taskId,
    description: entry.description,
    ...(entry.logFile ? { outputFile: entry.logFile } : {}),
    ...(snapshot.currentPhase ? { currentPhase: snapshot.currentPhase, summary: `phase: ${snapshot.currentPhase}` } : {}),
    ...(snapshot.workflowPhases.length > 0 ? { workflowPhases: snapshot.workflowPhases } : {}),
    ...(snapshot.workflowAgents.length > 0 ? { workflowAgents: snapshot.workflowAgents } : {}),
    usage: {
      totalTokens: snapshot.totalTokens,
      toolUses: snapshot.toolUses,
      durationMs: Math.max(0, now - entry.startedAtMs),
    },
  }
}

export function buildWorkflowNotificationEvent(
  entry: {
    toolUseId: string
    taskId: string
    description: string
    logFile?: string
    startedAtMs: number
  },
  taskStatus: 'completed' | 'failed' | 'stopped',
  snapshot: AntigravityWorkflowLiveSnapshot | null,
  fallbackResultText?: string,
  now = Date.now(),
): AgentEvent {
  const resultText = snapshot?.resultText ?? (fallbackResultText?.trim() || undefined)
  return {
    type: 'task_notification',
    toolUseId: entry.toolUseId,
    taskId: entry.taskId,
    taskStatus,
    outputFile: entry.logFile ?? '',
    summary: entry.description,
    ...(resultText ? { resultText } : {}),
    ...(snapshot
      ? {
          usage: {
            totalTokens: snapshot.totalTokens,
            toolUses: snapshot.toolUses,
            durationMs: Math.max(0, now - entry.startedAtMs),
          },
          ...(snapshot.workflowAgents.length > 0 ? { workflowAgents: snapshot.workflowAgents } : {}),
          ...(snapshot.workflowPhases.length > 0 ? { workflowPhases: snapshot.workflowPhases } : {}),
          ...(snapshot.currentPhase ? { currentPhase: snapshot.currentPhase } : {}),
        }
      : {}),
  }
}

export function pollWorkflowTaskProgress(
  entry: TrackedWorkflowTaskHandle,
  emitEvent: (event: AgentEvent) => void,
  brainRoots?: string[],
): void {
  if (entry.toolName !== 'Workflow' || !entry.taskId || !entry.emittedTaskStarted || entry.completed) return
  const snapshot = readAntigravityWorkflowSnapshot({
    logFile: entry.logFile,
    brainRoots,
  })
  if (!snapshot || snapshot.signature === entry.lastWorkflowProgressSignature) return
  entry.lastWorkflowProgressSignature = snapshot.signature
  emitEvent(
    buildWorkflowProgressEvent(
      {
        toolUseId: entry.toolUseId,
        taskId: entry.taskId,
        description: entry.description,
        logFile: entry.logFile,
        startedAtMs: entry.startedAtMs,
      },
      snapshot,
    ),
  )
}

export function startTrackedWorkflowTask(
  entry: TrackedWorkflowTaskHandle,
  emitEvent: (event: AgentEvent) => void,
  brainRoots?: string[],
): void {
  if (!entry.taskId) return
  if (!entry.emittedTaskStarted) {
    entry.emittedTaskStarted = true
    emitEvent({
      type: 'task_started',
      taskType: 'workflow',
      toolUseId: entry.toolUseId,
      taskId: entry.taskId,
      description: entry.description,
      ...(entry.logFile ? { outputFile: entry.logFile } : {}),
      isBackgrounded: true,
    })
  }
  pollWorkflowTaskProgress(entry, emitEvent, brainRoots)
}

export function finishTrackedWorkflowTask(
  entry: TrackedWorkflowTaskHandle,
  taskStatus: 'completed' | 'failed' | 'stopped',
  emitEvent: (event: AgentEvent) => void,
  opts?: { resultText?: string; brainRoots?: string[] },
): void {
  if (!entry.taskId) return
  const snapshot = readAntigravityWorkflowSnapshot({
    logFile: entry.logFile,
    fallbackText: opts?.resultText,
    brainRoots: opts?.brainRoots,
    finalStatus: taskStatus,
  })
  const base = {
    toolUseId: entry.toolUseId,
    taskId: entry.taskId,
    description: entry.description,
    logFile: entry.logFile,
    startedAtMs: entry.startedAtMs,
  }
  if (snapshot && snapshot.signature !== entry.lastWorkflowProgressSignature) {
    entry.lastWorkflowProgressSignature = snapshot.signature
    emitEvent(buildWorkflowProgressEvent(base, snapshot))
  }
  emitEvent(buildWorkflowNotificationEvent(base, taskStatus, snapshot, opts?.resultText))
}
