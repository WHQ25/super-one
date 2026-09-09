import { describe, expect, it } from 'vitest'
import { sessionTitleDocument } from './session-title-document'
import { sessionTitleAnimationCss } from '@superone/shared/session-title-animation'

describe('session title animation document', () => {
  it('embeds the desktop stylesheet unchanged and treats the title as data', () => {
    const html = sessionTitleDocument({ from: 'Old', to: '</script><script>alert(1)</script>',
      color: '#fff', primary: '#123456', fontSize: 15, fontWeight: '500', fontFamily: '-apple-system', letterSpacing: 0 })
    expect(html).toContain(sessionTitleAnimationCss)
    expect(html).not.toContain('"</script>')
    expect(html).toContain('\\u003c/script>')
    expect(html).toContain('span.textContent=ch')
  })
})
