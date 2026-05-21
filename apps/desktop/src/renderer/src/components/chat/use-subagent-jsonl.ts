import { useState, useEffect } from 'react'
import { useChatStore, useBashOutput } from '@/stores/chat'
import { parseJsonlOutput, type JsonlEntry } from './subagent-utils'

const SUBAGENT_OUTPUT_TAIL_LINES = 400

/** Persist the latest async subagent result text back onto its Task tool_use block. */
function persistTaskResultText(toolUseId: string, resultText: string): void {
  useChatStore.setState((s) => {
    const project = s.projectSessions[s.activeProject ?? '']
    if (!project) return s
    const sid = project._activeSessionId
    if (!sid) return s
    const session = project._sessions[sid]
    if (!session) return s
    return {
      projectSessions: {
        ...s.projectSessions,
        [s.activeProject!]: {
          ...project,
          _sessions: {
            ...project._sessions,
            [sid]: {
              ...session,
              messages: session.messages.map((msg) => ({
                ...msg,
                content: msg.content.map((block) =>
                  block.type === 'tool_use' && block.toolUseId === toolUseId
                    ? { ...block, taskResultText: resultText }
                    : block,
                ),
              })),
            },
          },
        },
      },
    }
  })
}

interface UseSubagentJsonlOptions {
  toolUseId: string
  taskResultText?: string
  outputFile?: string
  enabled: boolean
  isRunning: boolean
}

/**
 * Watches an async subagent's JSONL output file and parses it into interleaved
 * tool/activity entries. Shared by the inline SubagentBlock and the full-screen
 * SubagentFullView so both render identical async subagent activity.
 */
export function useSubagentJsonl({
  toolUseId,
  taskResultText,
  outputFile,
  enabled,
  isRunning,
}: UseSubagentJsonlOptions): { entries: JsonlEntry[]; resultText?: string } {
  const bashOutput = useBashOutput(toolUseId)
  const [entries, setEntries] = useState<JsonlEntry[]>([])
  const [resultText, setResultText] = useState<string>()
  const watchedContent = bashOutput && bashOutput.outputPath === outputFile ? bashOutput.content : ''

  useEffect(() => {
    setEntries([])
    setResultText(undefined)
  }, [outputFile])

  useEffect(() => {
    if (!outputFile || !enabled) return
    useChatStore.setState((s) => ({
      _bashOutputs: {
        ...s._bashOutputs,
        [toolUseId]: {
          content: s._bashOutputs[toolUseId]?.outputPath === outputFile ? s._bashOutputs[toolUseId]?.content ?? '' : '',
          finished: s._bashOutputs[toolUseId]?.outputPath === outputFile ? s._bashOutputs[toolUseId]?.finished ?? false : false,
          outputPath: outputFile,
        },
      },
    }))
    window.app.trace?.('subagent.output', 'start_watching', { outputFile, isRunning }, toolUseId)
    window.app.watchBashOutput(toolUseId, outputFile, SUBAGENT_OUTPUT_TAIL_LINES).catch((err) => {
      window.app.trace?.('subagent.output', 'watch_error', { outputFile, error: String(err) }, toolUseId)
    })
    return () => { window.app.unwatchBashOutput(toolUseId).catch(() => {}) }
  }, [enabled, isRunning, outputFile, toolUseId])

  useEffect(() => {
    if (!enabled || !outputFile || !watchedContent) return
    const parsed = parseJsonlOutput(watchedContent)
    window.app.trace?.('subagent.output', 'parsed', { entries: parsed.entries.length, hasResultText: !!parsed.resultText }, toolUseId)
    if (parsed.entries.length === 0 && !parsed.resultText) return
    setEntries(parsed.entries)
    setResultText(parsed.resultText)
    if (parsed.resultText && parsed.resultText !== taskResultText) {
      persistTaskResultText(toolUseId, parsed.resultText)
    }
  }, [enabled, outputFile, toolUseId, watchedContent])

  useEffect(() => {
    if (!enabled || isRunning || bashOutput?.outputPath !== outputFile || bashOutput?.finished !== true) return
    window.app.unwatchBashOutput(toolUseId).catch(() => {})
  }, [bashOutput?.finished, bashOutput?.outputPath, enabled, isRunning, outputFile, toolUseId])

  return { entries, resultText }
}
