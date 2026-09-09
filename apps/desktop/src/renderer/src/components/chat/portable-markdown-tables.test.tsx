/** @vitest-environment jsdom */

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PortableMarkdown } from '@superone/chat-view/PortableMarkdown'
import { CopyableMarkdown } from './CopyableMarkdown'

/**
 * Tables are GFM, not core markdown, so they only render when the remark plugin set
 * includes `remark-gfm`. The desktop spreads `defaultRemarkPlugins` into its runtime;
 * the phone's runtime never set `remarkPlugins` at all, and a table arrived as the
 * pipe-and-dash source text it was written as.
 *
 * The desktop is rendered alongside as the reference: what matters is not that some
 * table appears, but that both surfaces produce the same structure from one input.
 */
const TABLE = [
  '| Tool | Desktop | Mobile |',
  '| --- | --- | --- |',
  '| widget_show | WidgetBlock | portable frame |',
  '| config_read | compact row | compact row |',
].join('\n')

describe('markdown tables on the phone', () => {
  it('builds a real table element, not the source text', () => {
    const { container } = render(<PortableMarkdown text={TABLE} isStreaming={false} scheme="dark" />)

    expect(container.querySelector('table')).not.toBeNull()
    expect(container.textContent).not.toContain('| --- |')
  })

  it('keeps the header row and every body row', () => {
    const { container } = render(<PortableMarkdown text={TABLE} isStreaming={false} scheme="dark" />)

    expect(container.querySelectorAll('thead th')).toHaveLength(3)
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2)
    expect(container.textContent).toContain('widget_show')
    expect(container.textContent).toContain('portable frame')
  })

  it('matches the desktop cell count for the same source', () => {
    const phone = render(<PortableMarkdown text={TABLE} isStreaming={false} scheme="dark" />)
    const desktop = render(<CopyableMarkdown text={TABLE} isStreaming={false} />)

    expect(phone.container.querySelectorAll('td')).toHaveLength(
      desktop.container.querySelectorAll('td').length,
    )
  })

  it('renders the other GFM constructs that travel with tables', () => {
    // Strikethrough and task lists come from the same plugin, so a missing `remark-gfm`
    // takes all three out together — and only the table is visible enough to notice.
    const { container } = render(
      <PortableMarkdown
        text={'~~dropped~~\n\n- [x] done\n- [ ] pending'}
        isStreaming={false}
        scheme="dark"
      />,
    )

    expect(container.querySelector('del')).not.toBeNull()
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(2)
  })
})
