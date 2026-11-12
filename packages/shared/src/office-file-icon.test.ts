import { describe, expect, it } from 'vitest'
import { officeFileIconDataUri, officeFileIconSvg } from './office-file-icon'

describe('officeFileIconSvg', () => {
  it('maps each Office app, including the legacy extension, to its own mark', () => {
    expect(officeFileIconSvg('C:\\docs\\Q4.DOCX')).toBe(officeFileIconSvg('letter.doc'))
    expect(officeFileIconSvg('/finance/model.xlsx')).toBe(officeFileIconSvg('model.xls'))
    expect(officeFileIconSvg('model.xlsm')).toBe(officeFileIconSvg('model.xlsx'))
    expect(officeFileIconSvg('deck.pptx')).toBe(officeFileIconSvg('deck.ppt'))
    expect(officeFileIconSvg('letter.doc')).not.toBe(officeFileIconSvg('model.xls'))
    expect(officeFileIconSvg('model.xls')).not.toBe(officeFileIconSvg('deck.ppt'))
    expect(officeFileIconSvg('readme.md')).toBeUndefined()
    expect(officeFileIconSvg('letter.docx')).toContain('id="so-docx"')
    expect(officeFileIconSvg('model.xlsx')).toContain('id="so-xlsx"')
    expect(officeFileIconSvg('deck.pptx')).toContain('id="so-pptx"')
  })

  it('builds one data URI per mark', () => {
    const docx = officeFileIconDataUri('a.docx')
    expect(docx?.startsWith('data:image/svg+xml,')).toBe(true)
    expect(officeFileIconDataUri('b.doc')).toBe(docx)
    expect(officeFileIconDataUri('a.xlsx')).not.toBe(docx)
    expect(officeFileIconDataUri('a.pdf')).toBeUndefined()
  })
})
