import { useCallback, useMemo } from 'react'
import type { ComposerSource } from '@superone/shared/agent-types'
import { admitInputRequestSpec } from '@superone/shared/input-request'
import { desktopComposerPorts } from '@/lib/composer-view-ports'
import { useChatStore } from '@/stores/chat'
import { useSessionScope } from '@/stores/chat-store/session-scope'

/** The renderer supplies the widget's owner/message; iframe data supplies only the form spec. */
export function useWidgetInputs(toolUseId: string | undefined) {
  const scope = useSessionScope()
  const projectPath = useChatStore(state => scope?.projectPath ?? state.activeProject)
  const sessionId = useChatStore(state => scope?.sessionId ?? (projectPath ? state.projectSessions[projectPath]?._activeSessionId : null))
  const source = useCallback((): ComposerSource => {
    if (!projectPath || !sessionId || !toolUseId) throw new Error('This widget has no active session.')
    const message = useChatStore.getState().projectSessions[projectPath]?._sessions[sessionId]?.messages.find(message => message.role === 'assistant'
      && (message.content.some(block => block.type === 'tool_use' && block.toolUseId === toolUseId)
        || message.metadata?.codex?.items?.some(item => item.type === 'mcp_tool_call' && item.id === toolUseId
          && item.server === 'superone' && item.tool === 'widget_show')))
    if (!message) throw new Error('This widget is no longer in the session.')
    return { kind: 'widget', projectPath, sessionId, messageId: message.id }
  }, [projectPath, sessionId, toolUseId])
  const requestInput = useCallback(async (spec: unknown) => {
    const owner = source()
    if (owner.kind !== 'widget') throw new Error('This widget has no active session.')
    const admitted = admitInputRequestSpec(spec, { userResources: true })
    if (!admitted.ok) throw new Error(admitted.error)
    const { kind: _kind, ...scope } = owner
    const opened = await window.agent.openWidgetInputRequest({ ...scope, spec: admitted.spec })
    if (!opened.ok) throw new Error(opened.error.message)
  }, [source])
  const composerPorts = useMemo(() => desktopComposerPorts(source), [source])
  return { requestInput, composerPorts }
}

export function useWidgetInputRequest(toolUseId: string | undefined) { return useWidgetInputs(toolUseId).requestInput }
