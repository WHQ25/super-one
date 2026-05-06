import { useState, useCallback, useEffect } from 'react'
import { LinkSafetyModal } from '@/components/chat/LinkSafetyModal'
import { setExternalLinkHandler } from '@/lib/external-link'

export function ExternalLinkConfirm() {
  const [pendingUrl, setPendingUrl] = useState<string | null>(null)

  useEffect(() => {
    return setExternalLinkHandler((url) => setPendingUrl(url))
  }, [])

  const handleClose = useCallback(() => setPendingUrl(null), [])
  const handleConfirm = useCallback(() => {
    if (pendingUrl) window.app.openExternalLink(pendingUrl)
  }, [pendingUrl])

  if (!pendingUrl) return null

  return (
    <LinkSafetyModal
      url={pendingUrl}
      isOpen
      onClose={handleClose}
      onConfirm={handleConfirm}
    />
  )
}
