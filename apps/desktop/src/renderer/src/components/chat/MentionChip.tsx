import { NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { Bot, Folder, Globe, MousePointer2, Users } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { FileIcon } from '@superone/ui/components/ui/FileIcon'
import { MiniAppIcon } from '@/components/miniapp/MiniAppIcon'
import { DesktopAppIcon } from './DesktopAppIcon'
import type { MentionNodeAttrs } from './mention-node'

function CapabilityIcon({ kind }: { kind: MentionNodeAttrs['kind'] }) {
  if (kind === 'collab') return <Users className="size-3 shrink-0 text-violet-600 dark:text-violet-400" />
  // Match Settings / ComputerUseToolBlock branding (pointer, not monitor).
  if (kind === 'computer') return <MousePointer2 className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
  if (kind === 'browser') return <Globe className="size-3 shrink-0 text-sky-600 dark:text-sky-400" />
  return null
}

export function MentionChip({ node }: NodeViewProps) {
  const { kind, value, displayName } = node.attrs as MentionNodeAttrs
  const isCapability = kind === 'collab' || kind === 'computer' || kind === 'browser'
  // Desktop apps use the same blended chip style as Computer Use.
  const isBlendedChip = isCapability || kind === 'desktop-app'

  return (
    <NodeViewWrapper
      as="span"
      contentEditable={false}
      data-mention=""
      className={cn(
        'inline-flex items-center gap-1 select-none whitespace-nowrap align-middle',
        // Capability / desktop-app chips blend into surrounding text: no pill
        // background, same font-size as the editor body (matches the bubble).
        isBlendedChip
          ? 'mx-1 gap-0.5 text-[0.875rem] leading-none text-muted-foreground'
          : 'rounded bg-muted mx-0.5 px-1.5 py-0.5 text-xs leading-none text-foreground'
      )}
    >
      {kind === 'agent' ? (
        <Bot className="size-3 shrink-0 text-purple-600 dark:text-purple-400" />
      ) : kind === 'directory' ? (
        <Folder className="size-3 shrink-0 text-blue-600 dark:text-blue-400" />
      ) : kind === 'miniapp' ? (
        <MiniAppIcon appId={value} className="size-3 shrink-0" />
      ) : kind === 'desktop-app' ? (
        <DesktopAppIcon bundleId={value} className="size-3" />
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
