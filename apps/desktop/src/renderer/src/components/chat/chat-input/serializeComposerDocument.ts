import type { JSONContent } from '@tiptap/react'
import type { ImageAttachment } from '@superone/shared/agent-types'
import { isBuiltinCapabilityId } from '@superone/shared/capability-prompt-tags'
import { wrapAgentMention } from '@superone/shared/agent-mention-tags'
import { wrapGitMention } from '@superone/shared/git-mention-tags'
import { wrapMcpResourceMention } from '@superone/shared/mcp-app-mentions'
import { wrapPathRefMention } from '@superone/shared/user-mention-parser'
import type { InputSegment } from '@/stores/chat-store/types'
import type { MentionNodeAttrs } from '../mention-node'

function mentionText(attrs: MentionNodeAttrs): string {
  const { kind, value, displayName } = attrs
  if (kind === 'miniapp') return `<superone-miniapp><appname>${displayName}</appname><appid>${value}</appid></superone-miniapp>`
  if (kind === 'desktop-app') return `<superone-desktop-app><name>${displayName}</name><bundleId>${value}</bundleId></superone-desktop-app>`
  if (kind === 'session') return `<superone-session><title>${displayName}</title><sessionId>${value}</sessionId></superone-session>`
  if (kind === 'git') return wrapGitMention(value, displayName)
  if (kind === 'mcp-resource') return wrapMcpResourceMention(value, displayName)
  if (kind === 'agent-profile') return wrapAgentMention(value, displayName)
  if (isBuiltinCapabilityId(kind)) return `<superone-capability><name>${displayName}</name><id>${kind}</id></superone-capability>`
  const path = kind === 'directory' && value && !value.endsWith('/') ? `${value}/` : value
  return wrapPathRefMention(kind === 'directory' || kind === 'agent' ? kind : 'file', path, displayName || path)
}

/** Shared by the text composer and native media output; preserves chips and attachment order. */
export function serializeComposerDocument(doc: JSONContent | null, text: string, attachments: ImageAttachment[]) {
  const segments: InputSegment[] = []
  const mentions: MentionNodeAttrs[] = []
  let current = ''
  const flush = () => { if (current.trim()) segments.push({ text: current.trim(), isPaste: false }); current = '' }
  function visit(node: JSONContent) {
    if (node.type === 'text') current += node.text ?? ''
    else if (node.type === 'mention') {
      const attrs = node.attrs as MentionNodeAttrs
      mentions.push(attrs)
      current += ` ${mentionText(attrs)} `
    } else if (node.type === 'attachment') { flush(); segments.push({ attachmentId: node.attrs!.id }) }
    else if (node.type === 'hardBreak') current += '\n'
    else if (node.type === 'pasteChip') { flush(); segments.push({ text: node.attrs!.text, isPaste: true }) }
    else if (node.content && current.length) current += '\n'
    for (const child of node.content ?? []) visit(child)
  }
  if (doc) for (const child of doc.content ?? []) visit(child)
  else current = text
  flush()
  const orderedAttachments = segments.flatMap(segment => 'attachmentId' in segment
    ? attachments.filter(attachment => attachment.id === segment.attachmentId) : [])
  return { segments, mentions, attachments: orderedAttachments }
}
