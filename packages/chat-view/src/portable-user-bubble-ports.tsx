import { useContext, useEffect, useMemo, type ReactNode } from 'react'
import type { ImageAttachment } from '@superone/shared/agent-types'
import { parseMcpMentionValue } from '@superone/shared/mcp-app-mentions'
import { McpAppIcon } from '@superone/ui/components/ui/mcp-app-icon'
import { mcpResourceMentionIcon } from '@superone/ui/components/ui/mention-icons'
import { requestNative, requestNativeAsync } from './bridge'
import { previewImage } from './image-preview'
import { PortableTurnContext } from './portable-turn-context'
import { McpMentionSentTap } from './presenters/McpMentionCard'
import {
  DEFAULT_USER_BUBBLE_PORTS, DefaultMentionIcon, UserBubblePortsProvider, type AttachmentViewerProps, type FileMentionProps,
  type UserBubblePorts,
} from './presenters/user-bubble-ports'

/**
 * The picture to open for an attachment. A transcript loaded from the host
 * carries only a thumbnail (`preview`), or nothing, so the original is fetched
 * through the `loadAttachment` native action; a bubble the phone painted itself
 * already holds the bytes.
 */
export async function attachmentImageSource(messageId: string, attachment: ImageAttachment): Promise<string> {
  if (!attachment.preview && attachment.base64) return `data:${attachment.mimeType};base64,${attachment.base64}`
  const result = await requestNativeAsync('loadAttachment', {
    messageId, name: attachment.name, ...(attachment.id ? { attachmentId: attachment.id } : {}),
  }) as { dataUri?: unknown } | null
  if (typeof result?.dataUri !== 'string') throw new Error('attachment unavailable')
  return result.dataUri
}

/** A tap on a file mention opens the host's file preview, as a tool row's file chip does. */
function PortableFileMention({ kind, value, chip }: FileMentionProps) {
  const { projectPath } = useContext(PortableTurnContext)
  if (kind !== 'file') return chip({})
  return chip({
    chipProps: {
      role: 'button',
      title: value,
      onClick: (event) => {
        // The bubble's own long-press menu must not open from a tap on the chip.
        event.stopPropagation()
        requestNative('previewFile', { path: value, ...(projectPath ? { root: projectPath } : {}) })
      },
    },
  })
}

/**
 * A tap on a picture opens the native viewer with its original; a document
 * (a PDF) opens on the native preview page, which fetches its bytes first.
 * Renders nothing itself.
 */
function PortableAttachmentViewer({ attachment, isDocument, messageId, open, onOpenChange }: AttachmentViewerProps) {
  useEffect(() => {
    if (!open) return
    onOpenChange(false)
    if (!messageId) return
    if (isDocument) {
      requestNative('previewAttachment', { messageId, name: attachment.name, ...(attachment.id ? { attachmentId: attachment.id } : {}) })
      return
    }
    attachmentImageSource(messageId, attachment)
      .then((src) => previewImage(src, { label: attachment.name }))
      // The host no longer has it (or is too old to answer): the chip stays as it is.
      .catch(() => {})
  }, [open, attachment, isDocument, messageId, onOpenChange])
  return null
}

function useSchemeIsDark(): boolean {
  return useContext(PortableTurnContext).scheme === 'dark'
}

/**
 * The phone's ports for user-bubble chips: artwork the host sent with the
 * projection, taps routed to the native shell, no hover.
 */
export function PortableUserBubblePorts({ mentionArtwork, children }: { mentionArtwork: Record<string, string>; children: ReactNode }) {
  const ports = useMemo<UserBubblePorts>(() => {
    function PortableMentionIcon({ kind, value, label }: { kind: string; value: string; label: string }) {
      const { mcpIcons } = useContext(PortableTurnContext)
      const artwork = kind === 'miniapp' || kind === 'desktop-app' ? mentionArtwork[`${kind}:${value}`] : undefined
      if (artwork) return <img src={`data:image/png;base64,${artwork}`} alt="" className="block size-full rounded-[22%] object-contain" />
      if (kind === 'mcp-resource') {
        const server = parseMcpMentionValue(value)?.server
        return <McpAppIcon src={server ? mcpIcons[server] : undefined} fallback={mcpResourceMentionIcon()} />
      }
      return <DefaultMentionIcon kind={kind} value={value} label={label} />
    }
    return {
      ...DEFAULT_USER_BUBBLE_PORTS,
      MentionIcon: PortableMentionIcon,
      FileMention: PortableFileMention,
      McpMention: McpMentionSentTap,
      copyText: async (text) => {
        requestNative('copyText', { text })
        return true
      },
      AttachmentViewer: PortableAttachmentViewer,
      useIsDark: useSchemeIsDark,
    }
  }, [mentionArtwork])
  return <UserBubblePortsProvider value={ports}>{children}</UserBubblePortsProvider>
}
