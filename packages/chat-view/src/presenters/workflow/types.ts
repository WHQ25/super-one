export type WorkflowHarnessKind = 'claude' | 'grok' | 'antigravity' | 'generic'

export type WorkflowScriptLanguage = 'rhai' | 'javascript' | 'python'

export interface WorkflowPhase {
  title: string
  detail?: string
  state?: string
}

export interface WorkflowMeta {
  name: string
  description: string
  phases: WorkflowPhase[]
}

export interface WorkflowLaunchInfo {
  harness?: WorkflowHarnessKind
  transcriptDir?: string
  logPath?: string
  taskId?: string
  runId?: string
  scriptPath?: string
  name?: string
  isBackgroundLaunchAck?: boolean
}

export interface WorkflowNormalizedAgent {
  agentId: string
  jsonlPath: string
  label: string
  prompt?: string
  toolCount: number
  tokens?: number
  resultText?: string
  result?: unknown
  phase?: string
  state?: string
  agentType?: string
  transcriptAvailable?: boolean
}

export interface WorkflowParsedLog {
  phases: WorkflowPhase[]
  agents: WorkflowNormalizedAgent[]
  logs: string[]
  resultText?: string
}

export interface WorkflowRunContext {
  cwd?: string | null
  providerSessionId?: string | null
  homedir?: string | null
}

export interface WorkflowParsedInput {
  name: string
  description: string
  script?: string
  scriptPath?: string
  phases: WorkflowPhase[]
}

export interface WorkflowRunNormalization {
  harness: WorkflowHarnessKind
  name?: string
  description?: string
  script?: string
  scriptPath?: string
  scriptLanguage: WorkflowScriptLanguage
  scriptCandidates: string[]
  phases: WorkflowPhase[]
  agents: WorkflowNormalizedAgent[]
  logs: string[]
  resultText?: string
  transcriptDir?: string
  logPath?: string
  taskId?: string
  runId?: string
  hasTranscript: boolean
  hasLogSource: boolean
  supportsJsReplay: boolean
  supportsStaticGraph: boolean
}

export interface WorkflowHarnessAdapter {
  readonly id: WorkflowHarnessKind
  matches: (input: string, summary?: string) => boolean
  parseInput: (input: string) => WorkflowParsedInput
  parseLaunch: (summary?: string) => WorkflowLaunchInfo
  resolveTranscriptDir?: (launch: WorkflowLaunchInfo, ctx: WorkflowRunContext) => string | undefined
  resolveScriptCandidates: (opts: { scriptPath?: string; transcriptDir?: string }) => string[]
  parseInlineResult?: (summary?: string) => WorkflowParsedLog | null
  parseLogFile?: (raw: string) => WorkflowParsedLog | null
  defaultLanguage: WorkflowScriptLanguage
  supportsJsReplay: boolean
  supportsStaticGraph: boolean
  usesAuthoritativeAgentJsonl: (jsonlPath: string) => boolean
}

export type WorkflowAgentRuntimeStatus = 'running' | 'failed' | 'done'

export type WorkflowAgentTileStatus = 'done' | 'running' | 'failed' | 'stopped' | 'queued'

export interface WorkflowGroupableAgent {
  phase?: string
  subworkflow?: string
}

export interface WorkflowSubworkflowInfo {
  name: string
  description?: string
  hostPhase?: string
  phases: WorkflowPhase[]
}

export interface WorkflowPhaseSection<A> {
  phase: WorkflowPhase
  agents: A[]
}

export interface WorkflowChildSection<A> {
  workflow: WorkflowSubworkflowInfo
  sections: WorkflowPhaseSection<A>[]
}

export interface WorkflowAgentGroup<A> extends WorkflowPhaseSection<A> {
  children: WorkflowChildSection<A>[]
}
