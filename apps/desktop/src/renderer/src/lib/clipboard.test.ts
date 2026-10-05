/** @vitest-environment jsdom */
import { markSuperOneCopy, mentionCopyHtml, pasteCopyHtml, pastePartsFromHtml } from './clipboard'

const IMG = '<img src="data:image/png;base64,QUJD" alt="shot.png">'

describe('pastePartsFromHtml', () => {
  it('keeps text and images in their copied order', async () => {
    const parts = pastePartsFromHtml(markSuperOneCopy(`${IMG} why is the ring<br>shown`))!

    expect(parts).toHaveLength(2)
    expect(parts[0]).toMatchObject({ file: { name: 'shot.png', type: 'image/png' } })
    expect(await (parts[0] as { file: File }).file.text()).toBe('ABC')
    expect(parts[1]).toEqual({ text: ' why is the ring\nshown' })
  })

  it('puts block boundaries on their own lines and drops spacing-only runs', () => {
    const parts = pastePartsFromHtml(markSuperOneCopy(`<p>before</p>${IMG}<p>after</p>`))!

    expect(parts.map((part) => ('text' in part ? part.text : 'IMG'))).toEqual(['before\n', 'IMG', '\nafter'])
  })

  it('turns mentions and paste chips back into chips, text around them kept', () => {
    const mention = { kind: 'file', value: 'src/a "b".ts', displayName: 'a "b".ts' }
    const html = markSuperOneCopy(`see ${mentionCopyHtml(mention, '@src/a "b".ts')} and：${pasteCopyHtml('line 1\n<line 2>')}`)

    expect(pastePartsFromHtml(html)).toEqual([{ text: 'see ' }, { mention }, { text: ' and：' }, { paste: 'line 1\n<line 2>' }])
  })

  it('keeps a mention with a malformed payload as its text', () => {
    expect(pastePartsFromHtml(markSuperOneCopy('<span data-superone-mention="{oops">@x</span>'))).toBeNull()
  })

  it('ignores HTML SuperOne did not write, so a page’s inline icons stay out', () => {
    expect(pastePartsFromHtml(`<p>page</p>${IMG}`)).toBeNull()
  })

  it('ignores remote and non-image sources', () => {
    expect(pastePartsFromHtml(markSuperOneCopy('<img src="https://example.com/a.png"><img src="data:text/plain;base64,QUJD">'))).toBeNull()
  })
})
