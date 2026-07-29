import { NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { Bot, Folder, Globe, Monitor, Users } from 'lucide-react'
import { FileIcon } from '@superone/ui/components/ui/FileIcon'
import { MiniAppIcon } from '@/components/miniapp/MiniAppIcon'
import type { MentionNodeAttrs } from './mention-node'

function CapabilityIcon({ kind }: { kind: MentionNodeAttrs['kind'] }) {
  if (kind === 'collab') return <Users className="size-3 shrink-0 text-violet-600 dark:text-violet-400" />
  if (kind === 'computer') return <Monitor className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
  if (kind === 'browser') return <Globe className="size-3 shrink-0 text-sky-600 dark:text-sky-400" />
  return null
}

export function MentionChip({ node }: NodeViewProps) {
  const { kind, value, displayName } = node.attrs as MentionNodeAttrs
  const isCapability = kind === 'collab' || kind === 'computer' || kind === 'browser'

  return (
    <NodeViewWrapper
      as="span"
      contentEditable={false}
      data-mention=""
      className="inline-flex items-center gap-1 rounded bg-muted mx-0.5 px-1.5 py-0.5 text-xs leading-none text-foreground select-none whitespace-nowrap align-middle"
    >
      {kind === 'agent' ? (
        <Bot className="size-3 shrink-0 text-purple-600 dark:text-purple-400" />
      ) : kind === 'directory' ? (
        <Folder className="size-3 shrink-0 text-blue-600 dark:text-blue-400" />
      ) : kind === 'miniapp' ? (
        <MiniAppIcon appId={value} className="size-3 shrink-0" />
      ) : isCapability ? (
        <CapabilityIcon kind={kind} />
      ) : (
        <FileIcon name={displayName} size={12} />
      )}
      <span className="max-w-30 truncate">
        {kind === 'agent' && displayName.includes(':') ? displayName.split(':').pop() : displayName}
      </span>
    </NodeViewWrapper>
  )
}
