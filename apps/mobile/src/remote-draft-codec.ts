import type { DraftAttachment, DraftSessionSettings, DraftUpsertRequest } from '@superone/shared/environment/draft-rpc'
import { documentFromText, plainMentionText, type MentionDocument, type MentionSegment, type MentionToken } from './mention-document'
import type { SessionComposerSnapshot } from './composer-session-drafts'
import type { NewSessionWorktreeSelection } from './worktree-state'

type Node = { type?: string; text?: string; attrs?: Record<string, unknown>; content?: Node[] }

/** Both editors speak the existing Tiptap persistence format. Attachments live
 * in the phone's tray; their stable ids are restored into desktop chip nodes. */
export function composerFromRemoteDraft(draft: { text: string; docJson?: object | null; attachments?: DraftAttachment[] }): SessionComposerSnapshot {
  const document: MentionSegment[] = []
  const addText = (text: string) => {
    if (!text) return
    const last = document.at(-1)
    if (last && 'text' in last) last.text += text
    else document.push({ text })
  }
  const walk = (node: Node) => {
    if (node.type === 'mention' && typeof node.attrs?.kind === 'string' && typeof node.attrs.value === 'string') {
      document.push({ mention: { kind: node.attrs.kind as MentionToken['kind'], value: node.attrs.value, displayName: String(node.attrs.displayName ?? node.attrs.value) } })
    } else if (node.type === 'pasteChip') addText(String(node.attrs?.text ?? ''))
    else if (node.type === 'hardBreak') addText('\n')
    else if (typeof node.text === 'string') addText(node.text)
    else for (const child of node.content ?? []) walk(child)
  }
  const doc = draft.docJson as Node | null
  if (doc?.type === 'doc' && Array.isArray(doc.content)) {
    doc.content.forEach((node, index) => { if (index) addText('\n'); walk(node) })
  } else addText(draft.text)
  return { text: plainMentionText(document), document,
    insertions: document.flatMap((segment) => 'mention' in segment ? [{ text: plainMentionText([segment]), mention: segment.mention }] : []),
    attachments: (draft.attachments ?? []).map(({ data, ...a }) => ({ ...a, base64: data })) }
}

export function remoteDraftFromComposer(id: string, projectPath: string, composer: SessionComposerSnapshot,
  settings: DraftSessionSettings, originSessionId?: string | null): DraftUpsertRequest {
  const document: MentionDocument = composer.document.length ? composer.document : documentFromText(composer.text, composer.insertions)
  const paragraphs: Node[] = [{ type: 'paragraph', content: [] }]
  for (const segment of document) {
    if ('mention' in segment) paragraphs.at(-1)!.content!.push({ type: 'mention', attrs: { ...segment.mention } })
    else segment.text.split('\n').forEach((text, index) => {
      if (index) paragraphs.push({ type: 'paragraph', content: [] })
      if (text) paragraphs.at(-1)!.content!.push({ type: 'text', text })
    })
  }
  const attachments = composer.attachments.map(({ base64, name, mimeType, id: attachmentId }, index) => ({
    name, mimeType, data: base64, id: attachmentId ?? `${id}-attachment-${index}`,
  }))
  for (const attachment of attachments) paragraphs.at(-1)!.content!.push({ type: 'attachment', attrs: { id: attachment.id } })
  return { id, projectPath, text: plainMentionText(document), docJson: { type: 'doc', content: paragraphs }, attachments,
    settings, harness: settings.harness, model: settings.harness === 'codex' ? settings.codexModel : settings.model,
    permissionMode: settings.permissionMode, originSessionId: originSessionId ?? null }
}

export function worktreeFromDraft(settings: DraftSessionSettings): NewSessionWorktreeSelection {
  if (settings.worktreePath) return { kind: 'existing', path: settings.worktreePath, ...(settings.gitBranch ? { branch: settings.gitBranch } : {}) }
  if (settings.pendingBaseBranch) return { kind: 'create', baseBranch: settings.pendingBaseBranch,
    mode: settings.pendingWorktreeMode === 'attach' || settings.pendingWorktreeMode === 'detach' ? settings.pendingWorktreeMode : 'branch',
    branchName: settings.pendingBranchName ?? '', carryLocalChanges: !!settings.pendingCarryLocalChanges }
  return { kind: 'local' }
}

export function draftWorktreeSettings(selection: NewSessionWorktreeSelection): Partial<DraftSessionSettings> {
  return { worktreePath: selection.kind === 'existing' ? selection.path : null,
    gitBranch: selection.kind === 'existing' ? selection.branch ?? null : null,
    pendingBaseBranch: selection.kind === 'create' ? selection.baseBranch : null,
    pendingWorktreeMode: selection.kind === 'create' ? selection.mode : null,
    pendingBranchName: selection.kind === 'create' ? selection.branchName : null,
    pendingCarryLocalChanges: selection.kind === 'create' && selection.carryLocalChanges }
}
