import { describe, expect, it } from 'vitest'
import { composerDraftKey, SessionComposerDrafts } from './composer-session-drafts'

const fileDraft = (text: string) => ({
  text,
  document: [{ text }] as const,
  insertions: [],
  attachments: [],
})

describe('per-session composer drafts', () => {
  it('keeps drafts isolated by session and restores the empty composer when none is stored', () => {
    const drafts = new SessionComposerDrafts()
    const sessionA = composerDraftKey('desk', '/proj', 'a')
    const sessionB = composerDraftKey('desk', '/proj', 'b')
    drafts.stash(sessionA, fileDraft('typed in A'))
    drafts.stash(sessionB, fileDraft('typed in B'))

    expect(drafts.load(sessionA).text).toBe('typed in A')
    expect(drafts.load(sessionB).text).toBe('typed in B')
    expect(drafts.load(composerDraftKey('desk', '/proj', 'c')).text).toBe('')
  })

  it('does not leak a landing draft into an existing session key', () => {
    const drafts = new SessionComposerDrafts()
    const landing = composerDraftKey('desk', '/proj', null)
    const live = composerDraftKey('desk', '/proj', 'live')
    drafts.stash(landing, fileDraft('new session idea'))

    expect(landing).not.toBe(live)
    expect(drafts.load(live).text).toBe('')
    expect(drafts.load(landing).text).toBe('new session idea')
  })

  it('drops an emptied draft so a later visit does not resurrect it', () => {
    const drafts = new SessionComposerDrafts()
    const key = composerDraftKey('desk', '/proj', 'a')
    drafts.stash(key, fileDraft('keep me'))
    drafts.stash(key, fileDraft(''))

    expect(drafts.load(key).text).toBe('')
  })

  it('parks attachments with the session they were attached to', () => {
    const drafts = new SessionComposerDrafts()
    const sessionA = composerDraftKey('desk', '/proj', 'a')
    const sessionB = composerDraftKey('desk', '/proj', 'b')
    const image = { name: 'shot.png', mimeType: 'image/png', base64: 'aaa' }
    drafts.stash(sessionA, { ...fileDraft('see attached'), attachments: [image] })

    expect(drafts.load(sessionA).attachments).toEqual([image])
    expect(drafts.load(sessionB).attachments).toEqual([])
  })
})
