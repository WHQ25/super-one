import { describe, expect, it } from 'vitest'
import { EMPTY_SESSION_COMPOSER } from './composer-session-drafts'
import { serializeMentionDocument } from './mention-document'
import { createSessionPayload } from './runtime-create-session'
import { continuationComposer } from './session-continuation'

const from = { sessionId: 'old', title: 'Fix the parser' }
const old = { kind: 'session' as const, value: 'old', displayName: 'Fix the parser' }

describe('continuationComposer', () => {
  it('mentions the old session ahead of its unsent draft and attachments', () => {
    const file = { kind: 'file' as const, value: 'src/a.ts', displayName: 'a.ts' }
    const image = { id: 'i', name: 'shot.png', mimeType: 'image/png', base64: 'AA==' }
    const next = continuationComposer(from, {
      text: '  then @src/a.ts', document: [{ text: '  then ' }, { mention: file }],
      insertions: [], attachments: [image],
    })
    expect(next.document).toEqual([{ mention: old }, { text: ' then ' }, { mention: file }])
    expect(next.text).toBe('@Fix the parser then @src/a.ts')
    expect(next.insertions).toEqual([{ text: '@Fix the parser', mention: old }, { text: '@src/a.ts', mention: file }])
    expect(next.attachments).toEqual([image])
    expect(serializeMentionDocument(next.document)).toContain('<sessionId>old</sessionId>')
  })

  it('holds just the mention for an empty draft and does not mention the old session twice', () => {
    expect(continuationComposer(from, EMPTY_SESSION_COMPOSER).document).toEqual([{ mention: old }, { text: ' ' }])
    expect(continuationComposer(from, { ...EMPTY_SESSION_COMPOSER, document: [{ mention: old }, { text: ' more' }] }).document)
      .toEqual([{ mention: old }, { text: ' more' }])
  })
})

describe('createSessionPayload', () => {
  it('names the session the new one continues', () => {
    const project = { environmentId: 'env', projectId: 'p' }
    expect(createSessionPayload(project, 'new', { continuesFrom: 'old' })).toMatchObject({ sessionId: 'new', continuesFrom: 'old' })
    expect(createSessionPayload(project, 'new', {})).not.toHaveProperty('continuesFrom')
  })
})
