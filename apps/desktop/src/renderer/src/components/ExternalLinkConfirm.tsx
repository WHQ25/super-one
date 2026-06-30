import { useState, useCallback, useEffect } from 'react'
import { LinkSafetyModal } from '@/components/chat/LinkSafetyModal'
import { setExternalLinkHandler } from '@/lib/external-link'
import { openBrowserTab } from '@/components/activity/activity-panel-api'

export function ExternalLinkConfirm({ enableInApp = true }: { enableInApp?: boolean } = {}) {
  const [pendingUrl, setPendingUrl] = useState<string | null>(null)

  useEffect(() => {
    return setExternalLinkHandler((url) => setPendingUrl(url))
  }, [])

  const handleClose = useCallback(() => setPendingUrl(null), [])
  const handleConfirm = useCallback(() => {
    if (pendingUrl) window.app.openExternalLink(pendingUrl)
  }, [pendingUrl])
  const handleOpenInApp = useCallback(() => {
    if (pendingUrl) openBrowserTab(pendingUrl)
  }, [pendingUrl])

  if (!pendingUrl) return null

  return (
    <LinkSafetyModal
      url={pendingUrl}
      isOpen
      onClose={handleClose}
      onConfirm={handleConfirm}
      onOpenInApp={enableInApp ? handleOpenInApp : undefined}
    />
  )
}
