import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@superone/ui/components/ui/button'
import { useActiveSession, useChatStore } from '@/stores/chat'

/**
 * Clickable OAuth login for an auth-rejected MCP call (`tool_use.authRequired`,
 * set by the Codex translator). Does not replay the tool.
 */
export function CodexMcpAuthAction({ server }: { server: string }) {
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
        server,
        apiProviderId ?? null,
      )
      if (res.success) toast.success(t('chat.codex.mcpReauthSuccess', { name: server }))
      else toast.error(t('chat.codex.mcpReauthFailed', { name: server, error: res.error ?? '' }))
    } finally {
      setBusy(false)
    }
  }, [activeProject, apiProviderId, server, t])

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="mt-1 h-7 text-xs"
      disabled={busy}
      onClick={() => void onSignIn()}
    >
      {busy ? t('chat.codex.mcpReauthenticating') : t('chat.codex.mcpSignIn', { name: server })}
    </Button>
  )
}
