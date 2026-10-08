import { AgentProfileIcon } from '@superone/ui/components/harness/AgentProfileIcon'
import { MentionChipContent } from '@superone/ui/components/ui/MentionChipBody'
import { staticMentionIcon } from '@superone/ui/components/ui/mention-icons'
import { PromptKeywordText, keywordMatchesBySegment } from '@superone/ui/components/ui/prompt-keyword-text'
import { cn } from '@superone/ui/lib/utils'
import type { PromptKeyword, PromptKeywordMatch } from '@superone/shared/prompt-keywords'
import { parseUserMentions, type UserMentionKind } from '@superone/shared/user-mention-parser'
import { isLongPaste, mentionCopyText, mentionLabel, type UserMention } from '@superone/shared/user-message-parts'
import { PasteChipPresenter } from './PasteChip'
import { useUserBubblePorts, type ChipActions } from './user-bubble-ports'

/** A mention chip's icon: the shared artwork where there is one, else the host's. */
export function MentionChipIcon({ kind, value, label }: { kind: string; value: string; label: string }) {
  const { MentionIcon } = useUserBubblePorts()
  if (kind === 'agent-profile') return <AgentProfileIcon refValue={value} />
  return staticMentionIcon(kind, value) ?? <MentionIcon kind={kind} value={value} label={label} />
}

/** A bubble mention copies as its `@` text, and pastes back into the composer as the chip. */
export function mentionCopyProps(mention: UserMention) {
  return { 'data-copy-text': mentionCopyText(mention), 'data-copy-mention': JSON.stringify(mention) }
}

/** A mention in a sent bubble: the composer's chip, with the host's actions for files and MCP resources. */
function UserMentionChip({ kind, value, displayName }: { kind: UserMentionKind; value: string; displayName?: string }) {
  const { useMentionKind, FileMention, McpMention } = useUserBubblePorts()
  const resolved = useMentionKind(kind, value)
  const label = mentionLabel(resolved, value, displayName)
  const chip = ({ chipProps, iconProps }: ChipActions = {}) => (
    <MentionChipContent
      kind={resolved}
      {...chipProps}
      // break-normal resists the bubble's break-all so labels wrap between words.
      className={cn('break-normal select-text', chipProps?.onClick && 'cursor-pointer')}
      {...mentionCopyProps({ kind: resolved, value, displayName: label })}
      icon={<MentionChipIcon kind={resolved} value={value} label={label} />}
      label={label}
      iconProps={iconProps}
    />
  )
  if (resolved === 'file' || resolved === 'directory') return <FileMention kind={resolved} value={value} label={label} chip={chip} />
  if (resolved === 'mcp-resource') return <McpMention value={value}>{chip()}</McpMention>
  return chip()
}

function RestText({ text, plain, keywords }: { text: string; plain: boolean; keywords?: PromptKeywordMatch[] }) {
  if (!plain && isLongPaste(text)) return <PasteChipPresenter text={text} selectable />
  return <span className="user-text-rest"><PromptKeywordText text={text} matches={keywords} /></span>
}

/**
 * A user message's text as both hosts show it: literal text, structured
 * mentions as chips (typed `@words` and Markdown stay text), pasted text as a
 * paste chip, and the prompt keywords the harness acted on painted as the
 * composer painted them. `isPaste` is the block's mark: `true` is one paste,
 * `false` is typed text, absent is a message from before pastes were marked,
 * whose long runs show as paste chips.
 */
export function UserTextPresenter({ text, isPaste, promptKeywords = [], keywordMatches: scanned }: {
  text: string
  isPaste?: boolean
  promptKeywords?: readonly PromptKeyword[]
  /** Matches per segment, already scanned over the whole message; otherwise this text alone is scanned. */
  keywordMatches?: PromptKeywordMatch[][] | null
}) {
  if (isPaste === true) return <PasteChipPresenter text={text} selectable />
  const segments = parseUserMentions(text)
  if (segments.length === 0) return null
  const keywordMatches = scanned !== undefined ? scanned : keywordMatchesBySegment(segments, promptKeywords)
  // Normal inline flow (see .user-text-with-mentions). A chip is display:inline,
  // so its label owns the baseline and long text wraps beside it.
  return (
    <span className="user-text-with-mentions">
      {segments.map((segment, i) => (segment.type === 'mention'
        ? <UserMentionChip key={i} kind={segment.kind} value={segment.value} displayName={segment.displayName} />
        : <RestText key={i} text={segment.text} plain={isPaste === false} keywords={keywordMatches?.[i]} />))}
    </span>
  )
}
