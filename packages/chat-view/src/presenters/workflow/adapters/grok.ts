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
import { looksLikeRhaiWorkflow } from '../script-language'
import type { WorkflowHarnessAdapter, WorkflowLaunchInfo, WorkflowParsedInput, WorkflowRunContext } from '../types'

export function resolveGrokWorkflowDir(input: {
  runId?: string | null
  cwd?: string | null
  providerSessionId?: string | null
  homedir?: string | null
}): string | undefined {
  const runId = input.runId?.trim()
  const cwd = input.cwd?.trim()
  const providerSessionId = input.providerSessionId?.trim()
  const homedir = input.homedir?.trim()
  if (!runId || !cwd || !providerSessionId || !homedir) return undefined
  if (runId.includes('/') || runId.includes('\\') || runId.includes('..')) return undefined
  if (providerSessionId.includes('/') || providerSessionId.includes('\\') || providerSessionId.includes('..')) {
    return undefined
  }
  const base = homedir.replace(/\\/g, '/').replace(/\/+$/, '')
  return `${base}/.grok/sessions/${encodeURIComponent(cwd)}/${providerSessionId}/workflows/${runId}`
}

function parseGrokInput(input: string): WorkflowParsedInput {
  const script = extractWorkflowScript(input)
  const scriptPath = extractWorkflowScriptPath(input)
  const obj = parseJsonObject(input)
  const source = obj?.source && typeof obj.source === 'object' && !Array.isArray(obj.source)
    ? obj.source as Record<string, unknown>
    : null
  const name = (obj ? strField(obj, 'name') : extractJsonStringValue(input, 'name') ?? undefined)
    ?? (source ? strField(source, 'name') : undefined)
    ?? ''
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

function parseGrokLaunch(summary?: string): WorkflowLaunchInfo {
  if (!summary) return {}
  const trimmed = summary.trim()
  if (trimmed.startsWith('{')) {
    const o = parseJsonObject(trimmed)
    if (o) {
      const scriptPath = strField(o, 'script_path', 'scriptPath')
      const explicitDir = strField(o, 'transcript_dir', 'transcriptDir')
      return {
        harness: 'grok',
        transcriptDir: explicitDir ?? workflowDirFromScriptPath(scriptPath),
        taskId: strField(o, 'task_id', 'taskId'),
        runId: strField(o, 'run_id', 'runId'),
        scriptPath,
        name: strField(o, 'name'),
      }
    }
  }
  return {}
}

export const grokWorkflowAdapter: WorkflowHarnessAdapter = {
  id: 'grok',
  defaultLanguage: 'rhai',
  supportsJsReplay: false,
  supportsStaticGraph: true,
  usesAuthoritativeAgentJsonl: () => false,
  matches(input: string, summary?: string): boolean {
    if (summary) {
      const trimmed = summary.trim()
      if (trimmed.startsWith('{')) {
        const o = parseJsonObject(trimmed)
        if (o && ('run_id' in o || 'task_id' in o || 'script_path' in o)) {
          return true
        }
      }
      if (/\.grok\/sessions\//i.test(summary) || /\.rhai\b/i.test(summary)) {
        return true
      }
    }
    const obj = parseJsonObject(input)
    if (obj && ('source' in obj || 'script_path' in obj || 'validate_only' in obj)) {
      return true
    }
    const scriptPath = extractWorkflowScriptPath(input)
    if (scriptPath?.toLowerCase().endsWith('.rhai')) return true
    const script = extractWorkflowScript(input)
    return Boolean(script && looksLikeRhaiWorkflow(script))
  },
  parseInput: parseGrokInput,
  parseLaunch: parseGrokLaunch,
  resolveTranscriptDir(launch: WorkflowLaunchInfo, ctx: WorkflowRunContext): string | undefined {
    if (launch.transcriptDir) return launch.transcriptDir
    return resolveGrokWorkflowDir({
      runId: launch.runId ?? launch.taskId,
      cwd: ctx.cwd,
      providerSessionId: ctx.providerSessionId,
      homedir: ctx.homedir,
    })
  },
  resolveScriptCandidates({ scriptPath, transcriptDir }): string[] {
    return [...new Set([
      scriptPath,
      workflowArtifactPath(transcriptDir, 'script.rhai'),
    ].filter((p): p is string => Boolean(p)))]
  },
}
