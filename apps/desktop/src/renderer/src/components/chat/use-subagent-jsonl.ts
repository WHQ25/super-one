import { useState, useEffect, useRef } from 'react'
import { useChatStore, useBashOutput } from '@/stores/chat'
import { mapMessagesStructural } from '@/stores/chat-store/event-reducer/shared'
import {
  startBashOutputLive,
  stopBashOutputLive,
} from '@/stores/chat-store/helpers/bash-output-live'
import { parseJsonlOutput, entriesFromRecords, type JsonlEntry } from './subagent-utils'

/** Live tail while running; completed agents get a full authoritative read. */
const SUBAGENT_OUTPUT_TAIL_LINES = 2000

/** Persist the latest async subagent result text back onto its Task tool_use block. */
function persistTaskResultText(toolUseId: string, resultText: string): void {
  useChatStore.setState((s) => {
    const project = s.projectSessions[s.activeProject ?? '']
    if (!project) return s
    const sid = project._activeSessionId
    if (!sid) return s
    const session = project._sessions[sid]
    if (!session) return s
    const nextMessages = mapMessagesStructural(session.messages, (block) => {
      if (block.type !== 'tool_use' || block.toolUseId !== toolUseId) return block
      if (block.taskResultText === resultText) return block
      return { ...block, taskResultText: resultText }
    })
    // Avoid projectSessions identity churn when the result text is unchanged.
    if (nextMessages === session.messages) return s
    return {
      projectSessions: {
        ...s.projectSessions,
        [s.activeProject!]: {
          ...project,
          _sessions: {
            ...project._sessions,
            [sid]: {
              ...session,
              messages: nextMessages,
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
  /**
   * Skip the Claude Agent SDK authoritative read. Required for Grok child-session
   * chat_history.jsonl (not under Claude's agent-<id>.jsonl layout).
   */
  skipAuthoritativeRead?: boolean
}

/**
 * Watches an async subagent's JSONL output file and parses it into interleaved
 * tool/activity entries. Shared by the inline SubagentBlock and the full-screen
 * SubagentFullView so both render identical async subagent activity.
 *
 * Local: desktop fs.watch. Remote: EnvironmentHost → node workspace.tailWatch*
 * (project temp/ or allowlisted ~/.grok/sessions|~/.claude/projects absolute paths).
 */
export function useSubagentJsonl({
  toolUseId,
  taskResultText,
  outputFile,
  enabled,
  isRunning,
  skipAuthoritativeRead = false,
}: UseSubagentJsonlOptions): { entries: JsonlEntry[]; resultText?: string } {
  const bashOutput = useBashOutput(toolUseId)
  const [entries, setEntries] = useState<JsonlEntry[]>([])
  const [resultText, setResultText] = useState<string>()
  const authoritativeReadFor = useRef<string | null>(null)
  const watchedContent = bashOutput && bashOutput.outputPath === outputFile ? bashOutput.content : ''

  useEffect(() => {
    setEntries([])
    setResultText(undefined)
    authoritativeReadFor.current = null
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
    const projectKey = useChatStore.getState().activeProject
    window.app.trace?.('subagent.output', 'start_watching', { outputFile, isRunning, projectKey }, toolUseId)
    // Local fs.watch or remote node tailWatch (incl. agent transcript absolute paths).
    const stop = startBashOutputLive({
      toolUseId,
      outputPath: outputFile,
      projectKey,
      tailLines: SUBAGENT_OUTPUT_TAIL_LINES,
    })
    return () => {
      stop()
    }
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
    stopBashOutputLive(toolUseId)
  }, [bashOutput?.finished, bashOutput?.outputPath, enabled, isRunning, outputFile, toolUseId])

  // Once the agent has finished, do one authoritative full read and overwrite the
  // tailed entries. Only overwrites on a non-empty read, so a path/dir mismatch
  // degrades to the live-tailed result rather than blanking it.
  // - Claude agent-*.jsonl: SDK parentUuid chain (getSubagentMessages)
  // - Grok chat_history.jsonl: full file read (parseJsonlOutput understands both formats)
  // - Remote Grok: live remote tail already accumulated full content; prefer that when present.
  useEffect(() => {
    if (!enabled || !outputFile || isRunning) return
    if (authoritativeReadFor.current === outputFile) return
    authoritativeReadFor.current = outputFile

    if (skipAuthoritativeRead) {
      // Prefer content already tailed (works for local + remote). Fall back to local file read.
      if (watchedContent) {
        const parsed = parseJsonlOutput(watchedContent)
        if (parsed.entries.length > 0 || parsed.resultText) {
          setEntries(parsed.entries)
          setResultText(parsed.resultText)
          window.app.trace?.('subagent.output', 'grok_history_from_tail', {
            entries: parsed.entries.length,
            hasResultText: !!parsed.resultText,
          }, toolUseId)
          return
        }
      }
      const root = useChatStore.getState().activeProject || outputFile
      // Local absolute read only (remote paths outside project won't work here).
      if (root && !String(root).startsWith('remote:')) {
        void window.app.readProjectFile?.(root, outputFile).then((file) => {
          const content = typeof file?.content === 'string' ? file.content : ''
          if (!content) return
          const parsed = parseJsonlOutput(content)
          if (parsed.entries.length === 0 && !parsed.resultText) return
          setEntries(parsed.entries)
          setResultText(parsed.resultText)
          window.app.trace?.('subagent.output', 'grok_history_read', {
            entries: parsed.entries.length,
            hasResultText: !!parsed.resultText,
          }, toolUseId)
        }).catch(() => {})
      }
      return
    }

    const dir = useChatStore.getState().activeProject ?? undefined
    window.app.readSubagentTranscript(outputFile, dir).then((records) => {
      if (!records || records.length === 0) return
      const parsed = entriesFromRecords(records)
      if (parsed.entries.length === 0 && !parsed.resultText) return
      setEntries(parsed.entries)
      setResultText(parsed.resultText)
      window.app.trace?.('subagent.output', 'authoritative_read', { entries: parsed.entries.length, hasResultText: !!parsed.resultText }, toolUseId)
      if (parsed.resultText && parsed.resultText !== taskResultText) {
        persistTaskResultText(toolUseId, parsed.resultText)
      }
    }).catch(() => {})
  }, [enabled, outputFile, isRunning, toolUseId, taskResultText, skipAuthoritativeRead, watchedContent])

  return { entries, resultText }
}
