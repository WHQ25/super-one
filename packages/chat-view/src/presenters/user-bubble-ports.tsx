import { createContext, useContext, type ComponentPropsWithoutRef, type ComponentType, type ReactElement, type ReactNode } from 'react'
import { Bot, ImageIcon } from 'lucide-react'
import type { ImageAttachment } from '@superone/shared/agent-types'
import type { ParsedFilePrefix } from '@superone/shared/file-quote-prefix'
import type { UserMentionKind } from '@superone/shared/user-mention-parser'
import { DefaultMiniAppIcon } from '@superone/ui/components/ui/DefaultMiniAppIcon'
import { FileIcon } from '@superone/ui/components/ui/FileIcon'
import { mcpResourceMentionIcon, staticMentionIcon } from '@superone/ui/components/ui/mention-icons'

/** What a chip spreads for its host's actions: on the chip, and on its icon (a drag handle). */
export interface ChipActions {
  chipProps?: ComponentPropsWithoutRef<'span'>
  iconProps?: ComponentPropsWithoutRef<'span'>
}

/** A chip's preview card: a header with title and actions, then the preview. */
export interface ChipCardProps {
  children: ReactNode
  title?: ReactNode
  actions?: ReactNode
  card?: ReactNode
}

export interface FileMentionProps {
  kind: 'file' | 'directory'
  value: string
  label: string
  chip: (actions: ChipActions) => ReactElement
}

export interface AttachmentViewerProps {
  attachment: ImageAttachment
  /** A PDF or other document rather than a picture. */
  isDocument: boolean
  messageId?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Where the user bubble's chips meet their host. The presenters own text,
 * chrome, labels and copy; a host supplies only the artwork it alone can
 * resolve and what a chip does when used: the desktop hovers, right-clicks,
 * drags and opens in its own panels, the phone taps and asks its native shell.
 */
export interface UserBubblePorts {
  /** Artwork for a mention kind without a static icon: a mini-app, a desktop app, an MCP server, a file. */
  MentionIcon: ComponentType<{ kind: string; value: string; label: string }>
  /** The kind a mention really is, where its text could not say (a directory saved without its slash). */
  useMentionKind: (kind: UserMentionKind, value: string) => UserMentionKind
  /** A file or directory mention: the host's actions around `chip`. */
  FileMention: ComponentType<FileMentionProps>
  /** A sent MCP mention: opens the copy the message carried. */
  McpMention: ComponentType<{ value: string; children: ReactNode }>
  /** A chip's preview card where the host has hover; a touch host passes `children` through. */
  ChipCard: ComponentType<ChipCardProps>
  copyText: (text: string) => Promise<boolean>
  /** Copies an image attachment; absent where the host cannot. */
  copyImage?: (attachment: ImageAttachment) => Promise<boolean>
  /** Shows an attachment in full while `open`; a host with its own viewer opens it and closes again. */
  AttachmentViewer: ComponentType<AttachmentViewerProps>
  /** The code of a quoted file selection. */
  QuoteBody: ComponentType<{ quote: ParsedFilePrefix; lineNums: number[] }>
  useIsDark: () => boolean
}

/** Every artwork the shared packages can draw without the host. */
export function DefaultMentionIcon({ kind, label }: { kind: string; value: string; label: string }) {
  if (kind === 'miniapp') return <DefaultMiniAppIcon />
  if (kind === 'desktop-app') return staticMentionIcon('computer')
  if (kind === 'mcp-resource') return mcpResourceMentionIcon()
  if (kind === 'agent') return <Bot />
  if (kind === 'attachment') return <ImageIcon />
  return <FileIcon name={label} size={16} />
}

/** The quoted code as plain text, for a host without a highlighter. */
export function PlainQuoteBody({ quote }: { quote: ParsedFilePrefix; lineNums: number[] }) {
  return (
    <pre className="max-h-64 overflow-auto whitespace-pre font-mono text-xs leading-relaxed text-foreground/85">
      {quote.body}
    </pre>
  )
}

const prefersDark = () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark')

/** Read-only, side-effect-free ports: stories and any host that has not wired its own. */
export const DEFAULT_USER_BUBBLE_PORTS: UserBubblePorts = {
  MentionIcon: DefaultMentionIcon,
  useMentionKind: (kind) => kind,
  FileMention: ({ chip }) => chip({}),
  McpMention: ({ children }) => children,
  ChipCard: ({ children }) => children,
  copyText: async (text) => {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      return false
    }
  },
  AttachmentViewer: () => null,
  QuoteBody: PlainQuoteBody,
  useIsDark: prefersDark,
}

const UserBubblePortsContext = createContext<UserBubblePorts>(DEFAULT_USER_BUBBLE_PORTS)

export const UserBubblePortsProvider = UserBubblePortsContext.Provider

export function useUserBubblePorts(): UserBubblePorts {
  return useContext(UserBubblePortsContext)
}
