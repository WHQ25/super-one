import type { Editor } from '@tiptap/core'
import {
  encodeGitMentionValue,
  extractGitHubItemTitle,
  findGitHubIssueOrPrUrls,
  gitHubMentionDisplayPrefix,
  type ParsedGitHubItemUrl,
} from '@superone/shared/git-mention-query'
import { loadGitMentionRefs } from './git-mention-query'
import { loadLinkPreview } from './link-preview/link-preview-loader'
import type { MentionNodeAttrs } from './mention-node'

export interface PastedGitHubLinkItem {
  link: ParsedGitHubItemUrl
  value: string
  prefix: string
  isSameRepo: boolean
}

export interface GitHubLinkPasteResult {
  content: Array<{ type: 'text'; text: string } | { type: 'mention'; attrs: MentionNodeAttrs }>
  mentions: MentionNodeAttrs[]
  items: PastedGitHubLinkItem[]
}

export function buildGitHubLinkPasteContent(
  text: string,
  currentGithubRepo?: string | null,
): GitHubLinkPasteResult | null {
  const links = findGitHubIssueOrPrUrls(text)
  if (links.length === 0) return null
  const content: GitHubLinkPasteResult['content'] = []
  const mentions: MentionNodeAttrs[] = []
  const items: PastedGitHubLinkItem[] = []
  let cursor = 0
  const pushText = (slice: string) => {
    if (slice) content.push({ type: 'text', text: slice })
  }
  for (const link of links) {
    if (link.start > cursor) pushText(text.slice(cursor, link.start))
    const isSameRepo = !!(currentGithubRepo && link.ownerRepo.toLowerCase() === currentGithubRepo.trim().toLowerCase())
    const id = isSameRepo && link.url === link.canonicalUrl ? link.number : link.url
    const value = encodeGitMentionValue(link.kind, id, 'github')
    const prefix = gitHubMentionDisplayPrefix(link, currentGithubRepo)
    const attrs: MentionNodeAttrs = { kind: 'git', value, displayName: prefix }
    content.push({ type: 'mention', attrs })
    mentions.push(attrs)
    items.push({ link, value, prefix, isSameRepo })
    cursor = link.end
  }
  if (cursor < text.length) pushText(text.slice(cursor))
  return { content, mentions, items }
}

async function fetchGitHubItemTitle(
  item: PastedGitHubLinkItem,
  fileRoot: string | null,
): Promise<string | null> {
  const preview = await loadLinkPreview(item.link.canonicalUrl).catch(() => null)
  const ogTitle = extractGitHubItemTitle(preview?.title, item.link.kind)
  if (ogTitle) return ogTitle
  if (fileRoot && item.isSameRepo) {
    const res = await loadGitMentionRefs(fileRoot, item.link.kind, item.link.number).catch(() => null)
    if (res?.ok) {
      const exact = res.refs.find((r) => r.id === item.link.number)
      const detail = exact?.detail.trim()
      if (detail) return detail
    }
  }
  return null
}

export function resolvePastedGitHubChipTitles(
  items: readonly PastedGitHubLinkItem[],
  fileRoot: string | null,
  getEditor: () => Editor | null,
): void {
  for (const item of items) {
    void fetchGitHubItemTitle(item, fileRoot).then((title) => {
      if (!title) return
      const editor = getEditor()
      if (!editor || editor.isDestroyed) return
      const nextDisplayName = `${item.prefix} ${title}`
      const { state } = editor
      const tr = state.tr
      let changed = false
      state.doc.descendants((node, pos) => {
        if (node.type.name !== 'mention') return
        const attrs = node.attrs as MentionNodeAttrs
        if (attrs.kind === 'git' && attrs.value === item.value && attrs.displayName === item.prefix) {
          tr.setNodeMarkup(pos, undefined, { ...attrs, displayName: nextDisplayName })
          changed = true
        }
      })
      if (changed) {
        tr.setMeta('addToHistory', false)
        editor.view.dispatch(tr)
      }
    })
  }
}
