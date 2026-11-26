import { extractJsonStringValue } from '@superone/shared/partial-json'
import { antigravityWorkflowAdapter } from './adapters/antigravity'
import { claudeWorkflowAdapter } from './adapters/claude'
import { grokWorkflowAdapter } from './adapters/grok'
import {
  extractWorkflowScript,
  extractWorkflowScriptPath,
  mergeWorkflowPhaseRows,
  parseJsonObject,
  parseWorkflowScript,
  strField,
  stripWorkflowNamePrefix,
  workflowArtifactPath,
  workflowDirFromScriptPath,
  workflowToolTargetLabel,
} from './helpers'
import { detectWorkflowScriptLanguage } from './script-language'
import type {
  WorkflowHarnessAdapter,
  WorkflowHarnessKind,
  WorkflowLaunchInfo,
  WorkflowMeta,
  WorkflowNormalizedAgent,
  WorkflowParsedInput,
  WorkflowPhase,
  WorkflowRunContext,
  WorkflowRunNormalization,
} from './types'

function parseGenericInput(input: string): WorkflowParsedInput {
  const script = extractWorkflowScript(input)
  const scriptPath = extractWorkflowScriptPath(input)
  const obj = parseJsonObject(input)
  const name = (obj ? strField(obj, 'name', 'Name') : extractJsonStringValue(input, 'name') ?? undefined) ?? ''
  const description = (
    obj
      ? strField(obj, 'description', 'Description')
      : extractJsonStringValue(input, 'description') ?? extractJsonStringValue(input, 'Description') ?? undefined
  ) ?? ''
  if (script) {
    const parsed = parseWorkflowScript(script)
    return {
      name: parsed.name || name,
      description: parsed.description || description,
      script,
      scriptPath,
      phases: parsed.phases,
    }
  }
  return { name, description, script, scriptPath, phases: [] }
}

function parseGenericLaunch(summary?: string): WorkflowLaunchInfo {
  if (!summary) return {}
  const trimmed = summary.trim()
  if (trimmed.startsWith('{')) {
    const o = parseJsonObject(trimmed)
    if (o) {
      const scriptPath = strField(o, 'scriptPath', 'script_path')
      const explicitDir = strField(o, 'transcriptDir', 'transcript_dir')
      return {
        transcriptDir: explicitDir ?? workflowDirFromScriptPath(scriptPath),
        taskId: strField(o, 'taskId', 'task_id'),
        runId: strField(o, 'runId', 'run_id'),
        scriptPath,
        name: strField(o, 'name'),
      }
    }
  }
  const grab = (label: string) => summary.match(new RegExp(`${label}:\\s*(\\S+)`))?.[1]
  const transcriptDir = grab('Transcript dir')
  const scriptPath = grab('Script file')
  const taskId = grab('Task ID') ?? summary.match(/\btask id:\s*(\S+)/i)?.[1]
  const runId = grab('Run ID') ?? (transcriptDir ? transcriptDir.split('/').pop() : undefined)
  if (!transcriptDir && !scriptPath && !taskId && !runId) return {}
  return {
    transcriptDir: transcriptDir ?? workflowDirFromScriptPath(scriptPath),
    taskId,
    runId,
    scriptPath,
  }
}

export const genericWorkflowAdapter: WorkflowHarnessAdapter = {
  id: 'generic',
  defaultLanguage: 'javascript',
  supportsJsReplay: true,
  supportsStaticGraph: true,
  usesAuthoritativeAgentJsonl: (jsonlPath: string) => /agent-[^/\\]+\.jsonl$/.test(jsonlPath),
  matches: () => true,
  parseInput: parseGenericInput,
  parseLaunch: parseGenericLaunch,
  resolveScriptCandidates({ scriptPath, transcriptDir }): string[] {
    return [...new Set([
      scriptPath,
      workflowArtifactPath(transcriptDir, 'script.js'),
      workflowArtifactPath(transcriptDir, 'script.rhai'),
    ].filter((p): p is string => Boolean(p)))]
  },
}

export const WORKFLOW_HARNESS_ADAPTERS: readonly WorkflowHarnessAdapter[] = [
  antigravityWorkflowAdapter,
  grokWorkflowAdapter,
  claudeWorkflowAdapter,
]

export function getWorkflowAdapter(kind: WorkflowHarnessKind | undefined): WorkflowHarnessAdapter {
  if (!kind || kind === 'generic') return genericWorkflowAdapter
  return WORKFLOW_HARNESS_ADAPTERS.find((adapter) => adapter.id === kind) ?? genericWorkflowAdapter
}

export function resolveWorkflowAdapter(
  input: string,
  summary?: string,
  hint?: WorkflowHarnessKind,
): WorkflowHarnessAdapter {
  if (hint && hint !== 'generic') {
    return getWorkflowAdapter(hint)
  }
  for (const adapter of WORKFLOW_HARNESS_ADAPTERS) {
    if (adapter.matches(input, summary)) return adapter
  }
  return genericWorkflowAdapter
}

export function parseWorkflowInput(input: string): WorkflowMeta {
  const adapter = resolveWorkflowAdapter(input)
  const parsed = adapter.parseInput(input)
  return {
    name: parsed.name,
    description: parsed.description,
    phases: parsed.phases,
  }
}

export function parseWorkflowLaunch(summary?: string): WorkflowLaunchInfo {
  if (!summary) return {}
  const adapter = resolveWorkflowAdapter('', summary)
  const parsed = adapter.parseLaunch(summary)
  if (Object.keys(parsed).length > 0) return parsed
  return genericWorkflowAdapter.parseLaunch(summary)
}

export interface NormalizeWorkflowRunInput {
  input: string
  summary?: string
  harnessHint?: WorkflowHarnessKind
  runContext?: WorkflowRunContext
  scriptSource?: string
  loadedScriptPath?: string
  rawLogText?: string | null
  livePhases?: WorkflowPhase[]
  extraPhases?: Array<WorkflowPhase[] | undefined>
  agents?: WorkflowNormalizedAgent[]
  outputLogs?: string[]
  outputResultText?: string
  fallbackName?: string
  fallbackDescription?: string
}

export function normalizeWorkflowRun(params: NormalizeWorkflowRunInput): WorkflowRunNormalization {
  const adapter = resolveWorkflowAdapter(params.input, params.summary, params.harnessHint)
  const parsedInput = adapter.parseInput(params.input)
  const launch = adapter.parseLaunch(params.summary)
  const transcriptDir = adapter.resolveTranscriptDir
    ? adapter.resolveTranscriptDir(launch, params.runContext ?? {})
    : launch.transcriptDir
  const scriptPath = launch.scriptPath ?? parsedInput.scriptPath
  const scriptCandidates = adapter.resolveScriptCandidates({ scriptPath, transcriptDir })
  const effectiveScriptPath = params.loadedScriptPath ?? scriptPath ?? scriptCandidates[0]
  const effectiveScript = params.scriptSource ?? parsedInput.script
  const scriptLanguage = detectWorkflowScriptLanguage(
    effectiveScript,
    effectiveScriptPath,
    adapter.defaultLanguage,
  )
  const parsedLog = params.rawLogText
    ? adapter.parseLogFile?.(params.rawLogText) ?? null
    : adapter.parseInlineResult?.(params.summary) ?? null
  const name = parsedInput.name
    || params.fallbackName
    || launch.name
    || (adapter.id === 'antigravity' ? undefined : workflowToolTargetLabel(params.input))
    || undefined
  const description = stripWorkflowNamePrefix(
    parsedInput.description || params.fallbackDescription || undefined,
    name,
  )
  const phases = mergeWorkflowPhaseRows(
    params.livePhases,
    parsedLog?.phases,
    ...(params.extraPhases ?? []),
    parsedInput.phases,
  )
  const agents = params.agents?.length
    ? params.agents
    : parsedLog?.agents ?? []
  const logs = params.outputLogs?.length
    ? params.outputLogs
    : parsedLog?.logs ?? []
  const resultText = params.outputResultText ?? parsedLog?.resultText

  return {
    harness: adapter.id,
    name,
    description,
    script: parsedInput.script,
    scriptPath: effectiveScriptPath,
    scriptLanguage,
    scriptCandidates,
    phases,
    agents,
    logs,
    resultText,
    transcriptDir,
    logPath: launch.logPath,
    taskId: launch.taskId,
    runId: launch.runId,
    hasTranscript: Boolean(transcriptDir),
    hasLogSource: Boolean(launch.logPath),
    supportsJsReplay: adapter.supportsJsReplay && scriptLanguage === 'javascript',
    supportsStaticGraph: adapter.supportsStaticGraph,
  }
}
