/** @vitest-environment jsdom */
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { WidgetData } from '@superone/shared/generative-ui/types'
import { WidgetBlock } from './WidgetBlock'

function widget(overrides: Partial<WidgetData> = {}): WidgetData {
  return { title: 'probe', widget_code: '<div>hi</div>', width: 800, height: 300, isSVG: false, ...overrides }
}

function renderIframe(data = widget()): HTMLIFrameElement {
  const { container } = render(<WidgetBlock data={data} />)
  const iframe = container.querySelector('iframe')
  if (!iframe) throw new Error('widget iframe did not render')
  return iframe
}

describe('widget iframe origin isolation', () => {
  it('sandboxes the widget without allow-same-origin so its script cannot reach host globals', () => {
    expect(renderIframe().getAttribute('sandbox')).toBe('allow-scripts')
  })

  it('keeps the bridge free of parent-document access so it survives an opaque origin', () => {
    const srcdoc = renderIframe().getAttribute('srcdoc') ?? ''
    expect(srcdoc).not.toContain('parent.document')
  })

  it('still ships the postMessage bridge the host relies on', () => {
    const srcdoc = renderIframe().getAttribute('srcdoc') ?? ''
    expect(srcdoc).toContain('widget-resize')
    expect(srcdoc).toContain('widget-sendPrompt')
  })
})
