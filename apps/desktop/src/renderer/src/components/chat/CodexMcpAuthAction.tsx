import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { CodexMcpToolCallItem } from '@superone/shared/agent-types'
import { Button } from '@superone/ui/components/ui/button'
import { useActiveSession, useChatStore } from '@/stores/chat'

export function hasCodexMcpAuthChallenge(item: CodexMcpToolCallItem): boolean {
  if (item.authRequired) return true
  const meta = item.result?.meta
  return Boolean(meta && (meta['mcp/www_authenticate'] ?? meta.mcpWwwAuthenticate))
}

/** Clickable OAuth login for an auth-rejected Codex MCP tool result. Does not replay the tool. */
export function CodexMcpAuthAction({ item }: { item: CodexMcpToolCallItem }) {
  const { t } = useTranslation()
  const activeProject = useChatStore((s) => s.activeProject)
  const apiProviderId = useActiveSession((s) => s.apiProviderId)
  const [busy, setBusy] = useState(false)

  const onSignIn = useCallback(async () => {
    if (!activeProject) return
    setBusy(true)
    try {
      const res = await window.app.codexMcpServerOauthLogin(
        activeProject,
        item.server,
        apiProviderId ?? null,
      )
      if (res.success) toast.success(t('chat.codex.mcpReauthSuccess', { name: item.server }))
      else toast.error(t('chat.codex.mcpReauthFailed', { name: item.server, error: res.error ?? '' }))
    } finally {
      setBusy(false)
    }
  }, [activeProject, apiProviderId, item.server, t])

  if (!hasCodexMcpAuthChallenge(item)) return null

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="mt-1 h-7 text-xs"
      disabled={busy}
      onClick={() => void onSignIn()}
    >
      {busy ? t('chat.codex.mcpReauthenticating') : t('chat.codex.mcpSignIn', { name: item.server })}
    </Button>
  )
}
