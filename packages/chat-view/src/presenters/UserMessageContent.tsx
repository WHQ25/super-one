import { useMemo, type ComponentType } from 'react'
import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import type { PromptKeyword, PromptKeywordMatch } from '@superone/shared/prompt-keywords'
import { parseUserMentions, type UserTextSegment } from '@superone/shared/user-mention-parser'
import { keywordMatchesBySegment } from '@superone/ui/components/ui/prompt-keyword-text'
import { attachmentForBlock } from '@superone/shared/user-message-parts'
import { TooltipProvider } from '@superone/ui/components/ui/tooltip'
import { ModSite } from '../mod-ui/react'
import { stringProp, userMessageProps } from '../mod-ui/site-props'
import { AttachmentChipPresenter } from './AttachmentChip'
import { McpMentionSentProvider } from './McpMentionCard'
import { UserSelectionChip } from './UserSelectionChip'
import { UserTextPresenter } from './UserText'

/** Stands for a chip block (an attachment, a paste) in the scan: one non-word character, as in the composer's draft. */
const CHIP_SEGMENT: UserTextSegment = { type: 'mention', kind: 'file', value: '' }

/**
 * Keyword matches per text block, scanned over the whole message the way the
 * composer scanned its draft: a quote that spans an attachment still rules.
 */
function messageKeywordMatches(message: ChatMessage, text: string | null | undefined, keywords: readonly PromptKeyword[]): Map<number, PromptKeywordMatch[][]> {
  const byBlock = new Map<number, PromptKeywordMatch[][]>()
  if (keywords.length === 0) return byBlock
  const segments: UserTextSegment[] = []
  const ranges: Array<[index: number, from: number, to: number]> = []
  message.content.forEach((block, index) => {
    if (block.type === 'text' && block.isPaste !== true) {
      const own = parseUserMentions(text ?? block.text)
      ranges.push([index, segments.length, segments.length + own.length])
      segments.push(...own)
    } else if (block.type === 'text' || block.type === 'image' || block.type === 'document') {
      segments.push(CHIP_SEGMENT)
    }
  })
  const matches = keywordMatchesBySegment(segments, keywords)
  for (const [index, from, to] of ranges) byBlock.set(index, matches ? matches.slice(from, to) : [])
  return byBlock
}

/**
 * A user bubble's content on both hosts: quoted selections, then the blocks in
 * the order they were written — attachments as inline chips, text through the
 * `UserMessage` mod site, anything else (a tool call) as the host's `Block`.
 * `text` replaces every text block's text: a goal shows its objective.
 */
export function UserMessageContentPresenter({ message, text, promptKeywords, Block }: {
  message: ChatMessage
  text?: string | null
  promptKeywords: readonly PromptKeyword[]
  Block: ComponentType<{ block: ContentBlock; index: number; message: ChatMessage }>
}) {
  const keywordMatches = useMemo(() => messageKeywordMatches(message, text, promptKeywords), [message, text, promptKeywords])
  return (
    <McpMentionSentProvider content={message.content}>
      <TooltipProvider delayDuration={200}>
        {message.userSelections && message.userSelections.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1">
            <UserSelectionChip selections={message.userSelections} readOnly />
          </div>
        )}
        {message.content.map((block, index) => {
          if (block.type === 'image' || block.type === 'document') {
            // A block whose attachment did not come along still shows its chip; opening it fetches the original.
            const att = attachmentForBlock(message, block) ?? { name: block.name, mimeType: '', base64: '', ...(block.id ? { id: block.id } : {}) }
            return <AttachmentChipPresenter key={index} att={att} document={block.type === 'document'} messageId={message.id} selectable />
          }
          if (block.type === 'text') {
            const blockText = text ?? block.text
            return (
              <ModSite key={index} component="UserMessage" instanceId={index === 0 ? message.id : `${message.id}:${index}`} props={userMessageProps(blockText)}>
                {(p) => {
                  const shown = stringProp(p, 'text', blockText)
                  // A mod that rewrote the text gets it scanned on its own.
                  return <UserTextPresenter text={shown} isPaste={block.isPaste} promptKeywords={promptKeywords} keywordMatches={shown === blockText ? keywordMatches.get(index) : undefined} />
                }}
              </ModSite>
            )
          }
          return <Block key={index} block={block} index={index} message={message} />
        })}
      </TooltipProvider>
    </McpMentionSentProvider>
  )
}
