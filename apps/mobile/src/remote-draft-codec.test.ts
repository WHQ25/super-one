import { describe, expect, it } from 'vitest'
import { composerFromRemoteDraft, remoteDraftFromComposer, worktreeFromDraft } from './remote-draft-codec'
import { serializeMentionDocument } from './mention-document'

describe('desktop draft restored on a phone', () => {
  it('preserves inline paste chips through phone editing and desktop draft save', () => {
    const content = [{ type: 'text', text: 'Before ' },
      { type: 'pasteChip', attrs: { text: 'short paste' } }, { type: 'text', text: ' after' }]
    const composer = composerFromRemoteDraft({ text: '', docJson: { type: 'doc', content: [{ type: 'paragraph', content }] } })
    expect(composer.document).toEqual([{ text: 'Before ' }, { paste: 'short paste' }, { text: ' after' }])
    const saved = remoteDraftFromComposer('d', '/repo', composer, { harness: 'codex' })
    expect(saved.docJson).toEqual({ type: 'doc', content: [{ type: 'paragraph', content }] })
  })
  it('round trips mention identities, multiline paste and attachments', () => {
    const draft = { id: 'd', text: 'fallback', docJson: { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Read ' }, { type: 'mention', attrs: { kind: 'file', value: '/repo/a.ts', displayName: 'a.ts' } }] },
      { type: 'pasteChip', attrs: { text: 'line one\nline two' } },
    ] }, attachments: [{ id: 'image', name: 'image.png', mimeType: 'image/png', data: 'YWJj' }] }
    const composer = composerFromRemoteDraft(draft)
    expect(serializeMentionDocument(composer.document)).toContain('/repo/a.ts')
    expect(composer.text).toContain('line one\nline two')
    expect(composer.attachments[0]).toMatchObject({ id: 'image', base64: 'YWJj' })
    const saved = remoteDraftFromComposer('d', '/repo', composer, { harness: 'codex', codexModel: 'gpt', codexReasoningEffort: 'high' })
    expect(composerFromRemoteDraft(saved).document).toEqual(composer.document)
    expect(saved.attachments).toEqual(draft.attachments)
    expect(saved.settings?.codexReasoningEffort).toBe('high')
  })
  it('restores existing and pending worktrees without losing carry changes', () => {
    expect(worktreeFromDraft({ worktreePath: '/repo/wt', gitBranch: 'feature' })).toEqual({ kind: 'existing', path: '/repo/wt', branch: 'feature' })
    expect(worktreeFromDraft({ pendingBaseBranch: 'main', pendingWorktreeMode: 'branch', pendingBranchName: 'fix', pendingCarryLocalChanges: true }))
      .toEqual({ kind: 'create', baseBranch: 'main', mode: 'branch', branchName: 'fix', carryLocalChanges: true })
  })
})
