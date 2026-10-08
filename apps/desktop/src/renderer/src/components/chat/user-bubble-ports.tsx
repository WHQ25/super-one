import { useEffect, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import type { ImageAttachment } from '@superone/shared/agent-types'
import type { UserMentionKind } from '@superone/shared/user-mention-parser'
import {
  DefaultMentionIcon, UserBubblePortsProvider, type AttachmentViewerProps, type FileMentionProps, type UserBubblePorts,
} from '@superone/chat-view/presenters/user-bubble-ports'
import { ChipHoverCard } from '@superone/ui/components/ui/ChipHoverCard'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@superone/ui/components/ui/dialog'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { AdaptiveContextMenu } from '@/components/AdaptiveContextMenu'
import { MiniAppIcon } from '@/components/miniapp/MiniAppIcon'
import { useIsDark } from '@/hooks/use-is-dark'
import { tryCopy, tryCopyImage } from '@/lib/clipboard'
import { hasTextSelection } from '@/lib/file-link'
import { useAppStore, selectEffectiveProjectRoot } from '@/stores/app'
import { DesktopAppIcon } from './DesktopAppIcon'
import { FileChipIcon } from './FileChipIcon'
import { ImageLightbox } from './image-lightbox'
import { McpMentionChipIcon } from './McpMentionRows'
import { McpMentionSentHover } from './McpMentionSent'
import { useFileMentionActions } from './MentionChip'
import { PdfPreview } from './PdfPreview'
import { QuoteCodeBody } from './QuoteCodeBody'

function DesktopMentionIcon({ kind, value, label }: { kind: string; value: string; label: string }) {
  if (kind === 'miniapp') return <MiniAppIcon appId={value} />
  if (kind === 'desktop-app') return <DesktopAppIcon bundleId={value} />
  if (kind === 'mcp-resource') return <McpMentionChipIcon value={value} />
  if (kind === 'file') return <FileChipIcon name={label} filePath={value} />
  return <DefaultMentionIcon kind={kind} value={value} label={label} />
}

/**
 * Mentions re-parsed from plain text only know a directory by its trailing `/`.
 * Older inserts (and some drop paths) lost that marker and rendered folders as
 * files, so an extensionless file mention is stat'ed once to recover it.
 */
function useDesktopMentionKind(kind: UserMentionKind, value: string): UserMentionKind {
  const [resolved, setResolved] = useState<UserMentionKind>(kind)
  useEffect(() => {
    setResolved(kind)
    if (kind !== 'file') return
    const bare = value.replace(/\/$/, '')
    const baseName = bare.split(/[/\\]/).pop() || bare
    if (!bare || baseName.includes('.')) return
    let cancelled = false
    const projectRoot = selectEffectiveProjectRoot(useAppStore.getState())
    const abs = bare.startsWith('/') ? bare : projectRoot ? `${projectRoot}/${bare}` : null
    if (!abs) return
    void window.app.pathStat(abs).then((stat) => {
      if (!cancelled && stat?.isDirectory) setResolved('directory')
    })
    return () => { cancelled = true }
  }, [kind, value])
  return resolved
}

/** A file mention acts like FileChip: click opens the file, the icon drags it out, right-click shows the file menu. */
function FileMentionActions({ value, label, chip }: FileMentionProps) {
  const { menu, chipProps, iconProps } = useFileMentionActions(value, label)
  return (
    <AdaptiveContextMenu items={menu.items} onOpen={menu.onOpen} yieldWhen={hasTextSelection}>
      {chip({ chipProps, iconProps })}
    </AdaptiveContextMenu>
  )
}

function DesktopFileMention(props: FileMentionProps) {
  return props.kind === 'file' ? <FileMentionActions {...props} /> : props.chip({})
}

/** Full-size preview dialog for a PDF attachment. */
function PdfAttachmentDialog({ attachment, onClose }: { attachment: ImageAttachment; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent showCloseButton={false} className="max-h-[90vh] max-w-4xl gap-0 overflow-hidden p-0">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <DialogTitle className="truncate text-sm font-medium">{attachment.name}</DialogTitle>
          <DialogClose asChild>
            <IconButton size="sm">
              <X />
            </IconButton>
          </DialogClose>
        </div>
        <PdfPreview base64={attachment.base64} />
      </DialogContent>
    </Dialog>
  )
}

/** The image viewer, or a PDF's preview. The desktop holds every attachment's bytes. */
function DesktopAttachmentViewer({ attachment, isDocument, open, onOpenChange }: AttachmentViewerProps) {
  if (!attachment.base64) return null
  if (isDocument) {
    return open ? <PdfAttachmentDialog attachment={attachment} onClose={() => onOpenChange(false)} /> : null
  }
  return <ImageLightbox src={`data:${attachment.mimeType};base64,${attachment.base64}`} alt={attachment.name} open={open} onOpenChange={onOpenChange} />
}

const DESKTOP_USER_BUBBLE_PORTS: UserBubblePorts = {
  MentionIcon: DesktopMentionIcon,
  useMentionKind: useDesktopMentionKind,
  FileMention: DesktopFileMention,
  McpMention: McpMentionSentHover,
  ChipCard: ChipHoverCard,
  copyText: tryCopy,
  copyImage: (attachment) => tryCopyImage(attachment.mimeType, attachment.base64),
  AttachmentViewer: DesktopAttachmentViewer,
  QuoteBody: QuoteCodeBody,
  useIsDark,
}

/** The desktop's hover, menus, drag and viewers for user-bubble and composer chips. */
export function DesktopUserBubblePorts({ children }: { children: ReactNode }) {
  return <UserBubblePortsProvider value={DESKTOP_USER_BUBBLE_PORTS}>{children}</UserBubblePortsProvider>
}
