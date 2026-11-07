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
import { useMentionAppIcon } from '@/lib/mention-catalog'
import { useIsDark } from '@/hooks/use-is-dark'
import { tryCopy, tryCopyImage } from '@/lib/clipboard'
import { toLocalFileUrl } from '@/lib/path-utils'
import { hasTextSelection } from '@/lib/file-link'
import { useMentionContext } from './use-mention-context'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import { FileChipIcon } from './FileChipIcon'
import { ImageLightbox } from './image-lightbox'
import { McpMentionChipIcon } from './McpMentionRows'
import { McpMentionSentHover } from './McpMentionSent'
import { useFileMentionActions } from './MentionChip'
import { PdfPreview } from './PdfPreview'
import { QuoteCodeBody } from './QuoteCodeBody'
import { WebLink } from './link-preview/WebLink'

function HostMentionAppIcon({ kind, value, label }: { kind: string; value: string; label: string }) {
  const { projectPath } = useMentionContext()
  const uri = useMentionAppIcon(projectPath, kind, value)
  return uri ? <img src={uri} alt="" draggable={false} className="size-3.5 rounded object-contain" />
    : <DefaultMentionIcon kind={kind} value={value} label={label} />
}

function MentionFileIcon({ value, label }: { value: string; label: string }) {
  const { fileRoot } = useMentionContext()
  return <FileChipIcon name={label} filePath={value} fileRoot={fileRoot} />
}

function DesktopMentionIcon({ kind, value, label }: { kind: string; value: string; label: string }) {
  if (kind === 'miniapp' || kind === 'desktop-app') return <HostMentionAppIcon kind={kind} value={value} label={label} />
  if (kind === 'mcp-resource') return <McpMentionChipIcon value={value} />
  if (kind === 'file') return <MentionFileIcon value={value} label={label} />
  return <DefaultMentionIcon kind={kind} value={value} label={label} />
}

/**
 * Mentions re-parsed from plain text only know a directory by its trailing `/`.
 * Older inserts (and some drop paths) lost that marker and rendered folders as
 * files, so an extensionless file mention is stat'ed once to recover it.
 */
function useDesktopMentionKind(kind: UserMentionKind, value: string): UserMentionKind {
  const { fileRoot } = useMentionContext()
  const [resolved, setResolved] = useState<UserMentionKind>(kind)
  useEffect(() => {
    setResolved(kind)
    if (kind !== 'file') return
    const bare = value.replace(/\/$/, '')
    const baseName = bare.split(/[/\\]/).pop() || bare
    if (!bare || baseName.includes('.')) return
    let cancelled = false
    const projectRoot = fileRoot
    if (projectRoot && parseRemoteProjectKey(projectRoot)) return
    const abs = bare.startsWith('/') ? bare : projectRoot ? `${projectRoot}/${bare}` : null
    if (!abs) return
    void window.app.pathStat(abs).then((stat) => {
      if (!cancelled && stat?.isDirectory) setResolved('directory')
    })
    return () => { cancelled = true }
  }, [kind, value, fileRoot])
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

/** A local zone file the window named, as a URL the renderer can paint. */
function localZoneImageSrc(attachment: ImageAttachment): string | null {
  const path = attachment.originalPath
  if (!path || attachment.mimeType === 'application/pdf') return null
  if (!path.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(path)) return null
  return toLocalFileUrl(path)
}

/** The image viewer, or a PDF's preview. A remote original opens from the local zone file. */
function DesktopAttachmentViewer({
  attachment,
  isDocument,
  open,
  onOpenChange,
  initialEditing,
  onReplaceAttachment,
}: AttachmentViewerProps) {
  if (isDocument) {
    if (!attachment.base64) return null
    return open ? <PdfAttachmentDialog attachment={attachment} onClose={() => onOpenChange(false)} /> : null
  }
  const inline = attachment.base64 ? `data:${attachment.mimeType};base64,${attachment.base64}` : null
  // A window thumbnail is the small copy. Open the zone file when this machine has it.
  const src = (!inline || attachment.preview) ? localZoneImageSrc(attachment) ?? inline : inline
  if (!src) return null
  return (
    <ImageLightbox
      src={src}
      alt={attachment.name}
      fileName={attachment.name}
      open={open}
      onOpenChange={onOpenChange}
      initialEditing={initialEditing}
      onReplaceAttachment={onReplaceAttachment}
    />
  )
}

const DESKTOP_USER_BUBBLE_PORTS: UserBubblePorts = {
  MentionIcon: DesktopMentionIcon,
  useMentionKind: useDesktopMentionKind,
  FileMention: DesktopFileMention,
  McpMention: McpMentionSentHover,
  ChipCard: ChipHoverCard,
  WebLink,
  copyText: tryCopy,
  copyImage: (attachment) => tryCopyImage(attachment.mimeType, attachment.base64),
  localAttachmentSrc: localZoneImageSrc,
  AttachmentViewer: DesktopAttachmentViewer,
  QuoteBody: QuoteCodeBody,
  useIsDark,
}

/** The desktop's hover, menus, drag and viewers for user-bubble and composer chips. */
export function DesktopUserBubblePorts({ children }: { children: ReactNode }) {
  return <UserBubblePortsProvider value={DESKTOP_USER_BUBBLE_PORTS}>{children}</UserBubblePortsProvider>
}
