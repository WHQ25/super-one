import { mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildAttachmentTurn, buildCodexAttachmentInput } from './attachment-turn'
import { MAX_ATTACHMENT_BYTES, MAX_TURN_ATTACHMENTS, validateTurnAttachments } from './attachment-validation'
import { PNG_ATTACHMENT, PDF_ATTACHMENT } from './test-fixtures/attachments'

let directory: string
const previous = process.env.SUPERONE_ATTACHMENTS_DIR
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'attachment-turn-'))
  process.env.SUPERONE_ATTACHMENTS_DIR = directory
})
afterEach(() => {
  if (previous === undefined) delete process.env.SUPERONE_ATTACHMENTS_DIR
  else process.env.SUPERONE_ATTACHMENTS_DIR = previous
  rmSync(directory, { recursive: true, force: true })
})

describe('attachment delivery', () => {
  it('preserves GIF bytes and the order of multiple inline images', () => {
    const gif = { name: 'pixel.gif', mimeType: 'image/gif', base64: 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' }
    const turn = buildAttachmentTurn([gif, PNG_ATTACHMENT], { inlineImages: true, requirePaths: true })
    expect(turn.inlineBlocks.map(block => block.type === 'image' ? block.source.data : '')).toEqual([gif.base64, PNG_ATTACHMENT.base64])
    expect(readFileSync(turn.attachments[0].path!).toString('base64')).toBe(gif.base64)
    const codex = buildCodexAttachmentInput('look', [gif, PNG_ATTACHMENT])
    expect(codex.slice(1)).toEqual(turn.attachments.map(attachment => ({ type: 'localImage', path: attachment.path })))
  })

  it('preserves mixed input order and names, inlining images but keeping PDFs on disk', () => {
    const turn = buildAttachmentTurn([PDF_ATTACHMENT, PNG_ATTACHMENT], { inlineImages: true })
    expect(turn.attachments.map(a => [a.index, a.name, a.inline])).toEqual([[0, 'notes.pdf', false], [1, 'shot.png', true]])
    expect(turn.inlineBlocks).toEqual([{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_ATTACHMENT.base64 } }])
    for (const a of turn.attachments) expect(readFileSync(a.path!).toString('base64')).toBe(a.base64)
    expect(turn.note).toContain('do not Read')
  })
  it('passes only image paths as localImage, with PDF paths in Codex text', () => {
    const input = buildCodexAttachmentInput('', [PNG_ATTACHMENT, PDF_ATTACHMENT])
    expect(input).toHaveLength(2)
    expect(input[0]).toMatchObject({ type: 'text', text: expect.stringContaining('notes.pdf') })
    expect(input[1]).toEqual({ type: 'localImage', path: expect.stringContaining('-shot.png') })
  })
  it('falls back to image bytes when allowed, but fails Codex and path-only PDFs on write failure', () => {
    const blocker = join(directory, 'file')
    writeFileSync(blocker, '')
    process.env.SUPERONE_ATTACHMENTS_DIR = blocker
    const turn = buildAttachmentTurn([PNG_ATTACHMENT], { inlineImages: true })
    expect(turn.attachments[0]).toMatchObject({ path: null, inline: true, error: expect.any(String) })
    expect(turn.inlineBlocks).toHaveLength(1)
    expect(turn.note).toContain('not saved locally')
    expect(() => buildCodexAttachmentInput('look', [PNG_ATTACHMENT])).toThrow('Could not save')
    expect(() => buildAttachmentTurn([PDF_ATTACHMENT], { inlineImages: true })).toThrow('Could not save')
  })
  it('validates the whole batch before writing any file', () => {
    expect(() => buildAttachmentTurn([PNG_ATTACHMENT, { ...PDF_ATTACHMENT, base64: 'garbage' }], { inlineImages: true })).toThrow('invalid base64')
    expect(readdirSync(directory)).toEqual([])
  })
  it('accepts data URLs without sending a nested base64 prefix', () => {
    const turn = buildAttachmentTurn([{ ...PNG_ATTACHMENT, base64: `data:image/png;base64,${PNG_ATTACHMENT.base64}` }], { inlineImages: true })
    expect(turn.attachments[0]!.base64).toBe(PNG_ATTACHMENT.base64)
  })
  it('does not claim PDF-only content was inlined', () => {
    expect(buildAttachmentTurn([PDF_ATTACHMENT], { inlineImages: true }).note).not.toContain('inline')
  })
})

describe('portable attachment admission', () => {
  it.each(['abc', 'AAAA====', '!!!!', 'iVBORw0KGgo=\n'])('rejects malformed data %s', base64 => {
    expect(() => validateTurnAttachments([{ ...PNG_ATTACHMENT, base64 }])).toThrow()
  })
  it('rejects MIME mismatches and excessive count', () => {
    expect(() => validateTurnAttachments([{ ...PNG_ATTACHMENT, mimeType: 'application/pdf' }])).toThrow('MIME')
    expect(() => validateTurnAttachments(Array(MAX_TURN_ATTACHMENTS + 1).fill(PNG_ATTACHMENT))).toThrow('at most')
  })
  it('enforces per-file and aggregate limits independently of pixel dimensions', () => {
    const bytes = Buffer.alloc(MAX_ATTACHMENT_BYTES)
    Buffer.from(PNG_ATTACHMENT.base64, 'base64').copy(bytes)
    const big = { ...PNG_ATTACHMENT, base64: bytes.toString('base64') }
    expect(() => validateTurnAttachments([big])).not.toThrow()
    expect(() => validateTurnAttachments(Array(4).fill(big))).toThrow('12 MB')
    expect(() => validateTurnAttachments([{ ...big, base64: Buffer.concat([bytes, Buffer.from([0])]).toString('base64') }])).toThrow('4 MB')
  })
})
