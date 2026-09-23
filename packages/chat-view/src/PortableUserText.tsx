import { Bot, Folder } from 'lucide-react'
import { FileIcon } from '@superone/ui/components/ui/FileIcon'
import { AgentProfileIcon } from '@superone/ui/components/harness/AgentProfileIcon'
import { staticMentionIcon } from '@superone/ui/components/ui/mention-icons'
import { DefaultMiniAppIcon } from '@superone/ui/components/ui/DefaultMiniAppIcon'
import { MentionChipBody } from '@superone/ui/components/ui/MentionChipBody'
import { parseUserMentions, type UserMentionKind } from '@superone/shared/user-mention-parser'
import { isStoredCapabilityId } from '@superone/shared/capability-prompt-tags'

function blended(kind: UserMentionKind) {
  return isStoredCapabilityId(kind) || kind === 'agent-profile' || kind === 'session' || kind === 'git' || kind === 'desktop-app'
}

/** User text is literal, as on desktop. Only explicit structured mentions become
 * chips; neither Markdown nor typed @words can manufacture identities. */
export function PortableUserText({ text, mentionArtwork = {} }: { text: string; mentionArtwork?: Record<string, string> }) {
  return <span className="user-text-with-mentions">{parseUserMentions(text).map((segment, index) => {
    if (segment.type === 'text') return <span key={index} className="user-text-rest">{segment.text}</span>
    const { kind, value, displayName } = segment
    const label = kind === 'miniapp' || blended(kind) ? displayName || value : value.replace(/[/\\]+$/, '').split(/[/\\]/).at(-1) || value
    if (kind === 'agent') return <span key={index} data-mention-kind={kind} title={value}
      className="box-decoration-clone break-normal rounded-md border border-primary/40 bg-primary/15 px-1.5 py-0.5 text-xs leading-5 font-medium text-primary">
      @{label}
    </span>
    const dynamic = kind === 'miniapp' || kind === 'desktop-app' ? mentionArtwork[`${kind}:${value}`] : undefined
    const icon = dynamic
      ? <img src={`data:image/png;base64,${dynamic}`} alt="" className="block size-full rounded-[22%] object-contain" />
      : (kind === 'agent-profile' ? <AgentProfileIcon refValue={value} /> : kind === 'directory' ? <Folder className="text-primary" /> : staticMentionIcon(kind, value)) ?? (kind === 'file' ? <FileIcon name={label} />
        : kind === 'miniapp' ? <DefaultMiniAppIcon /> : kind === 'desktop-app' ? staticMentionIcon('computer') : <Bot />)
    return <span key={index} data-mention-kind={kind} title={value}
      className={`mention-chip ${blended(kind) ? 'mention-chip--blended' : 'mention-chip--resource'}`}>
      <MentionChipBody icon={icon} label={label} />
    </span>
  })}</span>
}
