import { extractJsonStringValue } from '@superone/shared/partial-json'
import {
  extractPythonPhaseTitles,
  extractWorkflowScript,
  extractWorkflowScriptPath,
  parseJsonObject,
  parseWorkflowScript,
  strField,
  stripFileUri,
} from '../helpers'
import { looksLikePythonWorkflow } from '../script-language'
import type {
  WorkflowHarnessAdapter,
  WorkflowLaunchInfo,
  WorkflowNormalizedAgent,
  WorkflowParsedInput,
  WorkflowParsedLog,
  WorkflowPhase,
} from '../types'

const TASK_ID_RE = /\btask id:\s*(\S+)/i
const TASK_LOGS_RE = /(?:^|\r?\n)Task logs are available at:\s*([^\r\n]+)/i
const BG_ACK_RE = /Tool is running as a background task with task id:/i
const PHASE_LINE_RE = /^-\s+\[phase\]\s+(.+)$/i
const KNOWN_STATES = 'done|completed|complete|success|running|active|in_progress|pending|queued|started|failed|error|cancelled|canceled|stopped|killed'
const AGENT_KNOWN_STATE_RE = new RegExp(
  `^-\\s+\\[agent:([^\\]]+)\\]\\s+(.+?):\\s+(${KNOWN_STATES})(?:\\s*,\\s*[^():]+?)?\\s+\\(([^)]+)\\)(?::\\s*([\\s\\S]*))?$`,
  'i',
)
const AGENT_FALLBACK_RE = /^-\s+\[agent:([^\]]+)\]\s+(.+?):\s+([a-zA-Z_-]+)(?:\s*,\s*[^():]+?)?\s+\(([^)]+)\)(?::\s*([\s\S]*))?$/
const HEADER_SKIP_RE = /^(?:Created At|Completed At|Task Description|Tool is running as a background task|Task logs are available at|YOU MUST TAKE ONE OF THE FOLLOWING):?/i

function parseAgentResultValue(rawResult: string | undefined): { resultText?: string; result?: unknown } {
  if (!rawResult) return {}
  const trimmed = rawResult.trim()
  if (!trimmed) return {}
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (typeof parsed === 'string') return { resultText: parsed, result: parsed }
    if (parsed !== null && parsed !== undefined) {
      return { resultText: JSON.stringify(parsed, null, 2), result: parsed }
    }
  } catch {
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"'))
      || (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return { resultText: trimmed.slice(1, -1) }
    }
  }
  return { resultText: trimmed }
}

export function parseAntigravityWorkflowLog(raw: string): WorkflowParsedLog | null {
  if (!raw || !raw.trim()) return null
  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  const phases: WorkflowPhase[] = []
  const seenPhases = new Set<string>()
  const agentsById = new Map<string, WorkflowNormalizedAgent>()
  const logs: string[] = []
  const outputLines: string[] = []
  let currentPhase: string | undefined
  let inOutput = false

  for (const line of lines) {
    if (inOutput) {
      outputLines.push(line)
      continue
    }
    const trimmed = line.trim()
    if (!trimmed) continue
    if (/^Logs:$/i.test(trimmed)) continue
    if (/^Output:$/i.test(trimmed)) {
      inOutput = true
      continue
    }
    const inlineOutput = trimmed.match(/^Output:\s+(.+)$/i)
    if (inlineOutput) {
      inOutput = true
      outputLines.push(inlineOutput[1])
      continue
    }
    if (HEADER_SKIP_RE.test(trimmed)) continue

    const phaseMatch = trimmed.match(PHASE_LINE_RE)
    if (phaseMatch) {
      const title = phaseMatch[1].trim()
      if (title) {
        currentPhase = title
        if (!seenPhases.has(title)) {
          seenPhases.add(title)
          phases.push({ title })
        }
      }
      continue
    }

    const agentMatch = trimmed.match(AGENT_KNOWN_STATE_RE) ?? trimmed.match(AGENT_FALLBACK_RE)
    if (agentMatch) {
      const agentType = agentMatch[1].trim()
      const label = agentMatch[2].trim()
      const state = agentMatch[3].trim()
      const agentId = agentMatch[4].trim()
      const parsedResult = parseAgentResultValue(agentMatch[5])
      const existing = agentsById.get(agentId)
      const nextResultText = parsedResult.resultText !== undefined
        ? parsedResult.resultText
        : existing?.resultText
      const nextResult = parsedResult.result !== undefined
        ? parsedResult.result
        : existing?.result
      agentsById.set(agentId, {
        agentId,
        jsonlPath: '',
        label: label || existing?.label || agentId,
        toolCount: existing?.toolCount ?? 0,
        phase: existing?.phase ?? currentPhase,
        state: state || existing?.state,
        agentType: agentType || existing?.agentType,
        transcriptAvailable: false,
        ...(nextResultText !== undefined ? { resultText: nextResultText } : {}),
        ...(nextResult !== undefined ? { result: nextResult } : {}),
      })
      continue
    }

    const bulletMatch = trimmed.match(/^-\s+(.+)$/)
    if (bulletMatch) {
      logs.push(bulletMatch[1])
      continue
    }

    if (logs.length > 0) {
      logs[logs.length - 1] = `${logs[logs.length - 1]}\n${line}`
    }
  }

  const resultText = outputLines.join('\n').trim() || undefined
  const agents = [...agentsById.values()]
  if (phases.length === 0 && agents.length === 0 && logs.length === 0 && !resultText) {
    return null
  }
  return {
    phases,
    agents,
    logs,
    ...(resultText ? { resultText } : {}),
  }
}

function parseAntigravityInput(input: string): WorkflowParsedInput {
  const script = extractWorkflowScript(input)
  const scriptPath = extractWorkflowScriptPath(input)
  const obj = parseJsonObject(input)
  const name = (obj ? strField(obj, 'Name', 'name') : extractJsonStringValue(input, 'name') ?? undefined) ?? ''
  const description = (
    obj
      ? strField(obj, 'Description', 'description')
      : extractJsonStringValue(input, 'Description') ?? extractJsonStringValue(input, 'description') ?? undefined
  ) ?? ''
  if (script) {
    const parsed = parseWorkflowScript(script)
    const phases = parsed.phases.length > 0 ? parsed.phases : extractPythonPhaseTitles(script)
    return {
      name: parsed.name || name,
      description: parsed.description || description,
      script,
      scriptPath,
      phases,
    }
  }
  return { name, description, script, scriptPath, phases: [] }
}

function parseAntigravityLaunch(summary?: string): WorkflowLaunchInfo {
  if (!summary) return {}
  const taskId = summary.match(TASK_ID_RE)?.[1]
  const rawLog = summary.match(TASK_LOGS_RE)?.[1]
  const logPath = rawLog ? stripFileUri(rawLog) : undefined
  const isBackgroundLaunchAck = BG_ACK_RE.test(summary)
  if (!taskId && !logPath && !isBackgroundLaunchAck) return {}
  return {
    harness: 'antigravity',
    taskId,
    logPath,
    ...(isBackgroundLaunchAck ? { isBackgroundLaunchAck: true } : {}),
  }
}

export const antigravityWorkflowAdapter: WorkflowHarnessAdapter = {
  id: 'antigravity',
  defaultLanguage: 'python',
  supportsJsReplay: false,
  supportsStaticGraph: true,
  usesAuthoritativeAgentJsonl: () => false,
  matches(input: string, summary?: string): boolean {
    if (summary) {
      if (TASK_LOGS_RE.test(summary) || BG_ACK_RE.test(summary)) return true
      if (/(?:^|\n)-\s+\[(?:phase|agent:)/i.test(summary)) return true
    }
    const obj = parseJsonObject(input)
    if (obj && ('Script' in obj || 'ScriptPath' in obj || 'Description' in obj || 'WaitMsBeforeAsync' in obj)) {
      return true
    }
    if (!obj && /"(?:Script|ScriptPath|Description|WaitMsBeforeAsync)"\s*:/.test(input)) {
      return true
    }
    const scriptPath = extractWorkflowScriptPath(input)
    if (scriptPath?.toLowerCase().endsWith('.py')) return true
    const script = extractWorkflowScript(input)
    return Boolean(script && looksLikePythonWorkflow(script))
  },
  parseInput: parseAntigravityInput,
  parseLaunch: parseAntigravityLaunch,
  resolveScriptCandidates({ scriptPath }): string[] {
    return scriptPath ? [scriptPath] : []
  },
  parseInlineResult(summary?: string): WorkflowParsedLog | null {
    if (!summary || BG_ACK_RE.test(summary)) return null
    return parseAntigravityWorkflowLog(summary)
  },
  parseLogFile: parseAntigravityWorkflowLog,
}
