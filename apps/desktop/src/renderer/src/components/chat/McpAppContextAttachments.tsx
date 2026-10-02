import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { mcpAppContextAttachments } from '@superone/shared/mcp-apps-state'
import { ContextAttachments } from '@superone/ui/components/ui/context-attachments'
import { useActiveSession, useChatStore, useSessionScope } from '@/stores/chat'
import { useIsDark } from '@/hooks/use-is-dark'

/** Producer wiring; the presentation remains generic for future agent.setContext callers. */
export function McpAppContextAttachments() {
  const messages = useActiveSession(session => session.messages)
  const scope = useSessionScope()
  const fallback = useChatStore(store => {
    const projectPath = store.activeProject
    const sessionId = projectPath ? store.projectSessions[projectPath]?._activeSessionId : null
    return projectPath && sessionId ? `${projectPath}\0${sessionId}` : ''
  })
  const route = scope ?? (fallback ? { projectPath: fallback.split('\0')[0], sessionId: fallback.split('\0')[1] } : null)
  const routeKey = JSON.stringify(route)
  const currentRoute = useRef(routeKey); currentRoute.current = routeKey
  const isDark = useIsDark()
  const { t } = useTranslation()
  const items = useMemo(() => mcpAppContextAttachments(messages ?? [], isDark ? 'dark' : 'light')
    .map(item => item.fields === undefined ? item : { ...item, title: t('mcpApp.contextFields', { count: item.fields }) }), [messages, isDark, t])
  const [pending, setPending] = useState<{ route: string; views: string[] }>({ route: '', views: [] })
  const [error, setError] = useState<{ route: string; message: string }>()
  const removing = pending.route === routeKey ? items.filter(item => pending.views.includes(item.appInstanceId)).map(item => item.id) : []
  const remove = async (id: string) => {
    const item = items.find(item => item.id === id)
    if (!item || !route) return
    setPending(value => ({ route: routeKey, views: [...(value.route === routeKey ? value.views : []), item.appInstanceId] }))
    setError(undefined)
    try {
      const result = await window.environment.mcpAppRequest(route.projectPath, route.sessionId, { operation: 'removeModelContext', appInstanceId: item.appInstanceId, messageId: item.messageId, updateId: item.updateId, ...(item.blockIndex !== undefined ? { blockIndex: item.blockIndex } : {}) })
      if (!result.ok) throw new Error(result.error.code === 'approval_required' ? 'Unexpected context approval' : result.error.message)
    } catch (cause) {
      if (currentRoute.current === routeKey) setError({ route: routeKey, message: cause instanceof Error ? cause.message : String(cause) })
    } finally {
      setPending(value => value.route === routeKey ? { ...value, views: value.views.filter(view => view !== item.appInstanceId) } : value)
    }
  }
  return <ContextAttachments items={items} removing={removing} onRemove={id => { void remove(id) }} removeLabel={t('mcpApp.removeContext')} error={error?.route === routeKey ? error.message : undefined} className={items.length ? 'mb-2' : undefined} />
}
