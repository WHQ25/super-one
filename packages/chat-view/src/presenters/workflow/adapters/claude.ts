import { extractJsonStringValue } from '@superone/shared/partial-json'
import {
  extractWorkflowScript,
  extractWorkflowScriptPath,
  parseJsonObject,
  parseWorkflowScript,
  strField,
  workflowArtifactPath,
  workflowDirFromScriptPath,
} from '../helpers'
import type { WorkflowHarnessAdapter, WorkflowLaunchInfo, WorkflowParsedInput } from '../types'

function parseClaudeInput(input: string): WorkflowParsedInput {
  const script = extractWorkflowScript(input)
  const scriptPath = extractWorkflowScriptPath(input)
  const obj = parseJsonObject(input)
  const name = (obj ? strField(obj, 'name') : extractJsonStringValue(input, 'name') ?? undefined) ?? ''
  const description = (obj ? strField(obj, 'description') : extractJsonStringValue(input, 'description') ?? undefined)
    ?? ''
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

function parseClaudeLaunch(summary?: string): WorkflowLaunchInfo {
  if (!summary) return {}
  const trimmed = summary.trim()
  if (trimmed.startsWith('{')) {
    const o = parseJsonObject(trimmed)
    if (o) {
      const scriptPath = strField(o, 'scriptPath', 'script_path')
      const explicitDir = strField(o, 'transcriptDir', 'transcript_dir')
      return {
        harness: 'claude',
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
  const taskId = grab('Task ID')
  const runId = grab('Run ID') ?? (transcriptDir ? transcriptDir.split('/').pop() : undefined)
  if (!transcriptDir && !scriptPath && !taskId && !runId) return {}
  return {
    harness: 'claude',
    transcriptDir: transcriptDir ?? workflowDirFromScriptPath(scriptPath),
    taskId,
    runId,
    scriptPath,
  }
}

export const claudeWorkflowAdapter: WorkflowHarnessAdapter = {
  id: 'claude',
  defaultLanguage: 'javascript',
  supportsJsReplay: true,
  supportsStaticGraph: true,
  usesAuthoritativeAgentJsonl: (jsonlPath: string) => /agent-[^/\\]+\.jsonl$/.test(jsonlPath),
  matches(input: string, summary?: string): boolean {
    if (summary) {
      if (/(?:Transcript dir|Script file|Workflow launched in background)/i.test(summary)) {
        return true
      }
      const trimmed = summary.trim()
      if (trimmed.startsWith('{')) {
        const o = parseJsonObject(trimmed)
        if (o && ('transcriptDir' in o || 'runId' in o || o.status === 'async_launched')) {
          return true
        }
      }
    }
    const scriptPath = extractWorkflowScriptPath(input)
    if (scriptPath && /\.(?:js|mjs|ts)$/i.test(scriptPath)) return true
    const script = extractWorkflowScript(input)
    return Boolean(script && /\bexport\s+const\s+meta\b/.test(script))
  },
  parseInput: parseClaudeInput,
  parseLaunch: parseClaudeLaunch,
  resolveScriptCandidates({ scriptPath, transcriptDir }): string[] {
    return [...new Set([
      scriptPath,
      workflowArtifactPath(transcriptDir, 'script.js'),
    ].filter((p): p is string => Boolean(p)))]
  },
}
