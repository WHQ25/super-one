import { userCopyHtml } from './user-copy-html'

const image = { name: 'x"y.png', mimeType: 'image/png', base64: 'QUJD' }

describe('userCopyHtml', () => {
  it('keeps message order inline, escapes text, keeps line breaks and leaves PDFs out', () => {
    const html = userCopyHtml([{ attachment: image }, { attachment: { ...image, mimeType: 'application/pdf' } }, { text: 'a <b>\nnext' }])

    expect(html).toBe('<div data-superone-copy=""><img src="data:image/png;base64,QUJD" alt="x&quot;y.png">a &lt;b&gt;<br>next</div>')
  })

  it('writes mentions and paste chips as elements the composer turns back into chips', () => {
    const html = userCopyHtml([
      { mention: { kind: 'file', value: 'src/a.ts', displayName: 'a.ts' } },
      { mention: { kind: 'miniapp', value: 'app-1', displayName: 'Notes' } },
      { paste: 'x\ny' },
    ])

    expect(html).toBe('<div data-superone-copy="">'
      + '<span data-superone-mention="{&quot;kind&quot;:&quot;file&quot;,&quot;value&quot;:&quot;src/a.ts&quot;,&quot;displayName&quot;:&quot;a.ts&quot;}">@src/a.ts</span>'
      + '<span data-superone-mention="{&quot;kind&quot;:&quot;miniapp&quot;,&quot;value&quot;:&quot;app-1&quot;,&quot;displayName&quot;:&quot;Notes&quot;}">@Notes</span>'
      + '<div data-superone-paste="">x<br>y</div></div>')
  })
})
