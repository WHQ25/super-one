import type { ModRenderResult } from '@superone/shared/mod-ui'
import { firstEngineRef, treePlainText } from './ModTree'
import { isDrawableModTree } from './validate'

/**
 * The props SuperOne sends for each transcript and status site, shaped as the
 * CLI's `RenderPropsOf` declares them. The CLI passes host props to hooks
 * unchecked, so these builders are the contract (one test per site).
 */

/** Text the person (or SuperOne on their behalf) sent: the SDK host's own turn. */
export function userMessageProps(text: string) {
  return { text, origin: { kind: 'sdk' as const }, isExpanded: true }
}

export function assistantMessageProps(text: string, isFirstOfReply: boolean) {
  return { text, isFirstOfReply }
}

export interface ToolCallFacts {
  toolUseId: string
  tool: string
  input: unknown
  isRunning: boolean
  isErrored: boolean
  isInterrupted: boolean
  output?: unknown
}

export function toolUseProps(call: ToolCallFacts) {
  return {
    tool_use_id: call.toolUseId,
    tool: call.tool,
    input: call.input,
    isRunning: call.isRunning,
    isErrored: call.isErrored,
    isInterrupted: call.isInterrupted,
    ...(call.output === undefined ? {} : { output: call.output }),
  }
}

export function toolResultProps(call: Pick<ToolCallFacts, 'toolUseId' | 'tool' | 'output' | 'isErrored'>) {
  return { tool_use_id: call.toolUseId, tool: call.tool, output: call.output ?? null, isErrored: call.isErrored }
}

export function toolGroupProps(calls: ToolCallFacts[], isActive: boolean, isExpanded: boolean) {
  return {
    calls: calls.map((c) => ({ tool_use_id: c.toolUseId, tool: c.tool, input: c.input, isRunning: c.isRunning, isErrored: c.isErrored, isInterrupted: c.isInterrupted })),
    isActive,
    isExpanded,
  }
}

export function commandOutputProps(command: string, args: string, text: string, isErrored: boolean) {
  return { command: command.replace(/^\//, ''), args, text, isErrored }
}

export function askUserQuestionProps(questions: unknown[], metadataSource?: string) {
  return { tool: 'AskUserQuestion', questions, ...(metadataSource ? { metadataSource } : {}) }
}

export type SpinnerMode = 'requesting' | 'responding' | 'thinking' | 'tool-input' | 'tool-use'

export function spinnerProps(word: string, message: string | null, mode: SpinnerMode) {
  return { word, message, suffix: '…', mode }
}

export function sessionModeProps(modes: readonly string[]) {
  return { modes: [...modes] }
}

export function promptHintProps(isDraft: boolean, isWorking: boolean, hint: string) {
  return { isDraft, isWorking, hint }
}

/**
 * The hint a mod drew for the composer, as text: its own tree, with engine
 * nodes standing for the hint (the plugin's rewrite for the first ref). Null
 * for a tree SuperOne would not draw, so the composer keeps its own hint.
 */
export function promptHintText(result: ModRenderResult, requestProps: Record<string, unknown>): string | null {
  if (!isDrawableModTree(result.tree)) return null
  const first = firstEngineRef(result.tree)
  const hintOf = (ref: number) => stringProp(ref !== 0 && ref === first ? result.props : requestProps, 'hint', '')
  return treePlainText(result.tree, hintOf).replace(/\s+/g, ' ').trim()
}

/** Reads a string prop a plugin may have rewritten, falling back to SuperOne's own. */
export function stringProp(props: Record<string, unknown>, key: string, fallback: string): string {
  const value = props[key]
  return typeof value === 'string' ? value : fallback
}
