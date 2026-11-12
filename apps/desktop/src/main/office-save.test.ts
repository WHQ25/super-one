import { describe, expect, it } from 'vitest'
import { OFFICE_PREVIEW_MAX_BYTES } from '@superone/shared/file-preview'
import { officeBytesSaveRefusal } from './office-save'

describe('officeBytesSaveRefusal', () => {
  it('allows a local Office package inside the size cap', () => {
    expect(officeBytesSaveRefusal('/proj', 'docs/q.docx', 32)).toBeNull()
    expect(officeBytesSaveRefusal('/proj', 'model.xlsx', OFFICE_PREVIEW_MAX_BYTES)).toBeNull()
    expect(officeBytesSaveRefusal('/proj', 'deck.pptx', 8)).toBeNull()
  })

  it('refuses a remote project, a text file, and an empty or oversized package', () => {
    expect(officeBytesSaveRefusal('remote:node:/srv', 'docs/q.docx', 32)).toBe('remote')
    expect(officeBytesSaveRefusal('/proj', 'notes.md', 32)).toBe('not-office')
    expect(officeBytesSaveRefusal('/proj', 'legacy.doc', 32)).toBe('not-office')
    expect(officeBytesSaveRefusal('/proj', 'docs/q.docx', 0)).toBe('size')
    expect(officeBytesSaveRefusal('/proj', 'docs/q.docx', OFFICE_PREVIEW_MAX_BYTES + 1)).toBe('size')
    expect(officeBytesSaveRefusal('/proj', 'docs/q.docx', 1.5)).toBe('size')
  })
})
