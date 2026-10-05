/** @vitest-environment jsdom */
import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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
  it('returns unified composer values only to the opening iframe and settles a live document on reset', async () => {
    let finish!: (value: { status: 'submitted'; values: { notes: string } }) => void
    const ports = { open: vi.fn(() => new Promise<{ status: 'submitted'; values: { notes: string } }>(resolve => { finish = resolve })), release: vi.fn() }
    const { container } = render(<WidgetBlock data={widget()} composerPorts={ports} />)
    const frame = container.querySelector('iframe')!.contentWindow!, reply = vi.spyOn(frame, 'postMessage')
    const payload = { type: 'widget-composer-open', id: 'own', spec: { title: 'Notes' }, output: 'caller' }
    window.dispatchEvent(new MessageEvent('message', { source: window, data: payload }))
    expect(ports.open).not.toHaveBeenCalled()
    window.dispatchEvent(new MessageEvent('message', { source: frame, data: payload }))
    expect(ports.open).toHaveBeenCalledWith({ viewId: expect.any(String), localId: 'own', spec: payload.spec, output: 'caller' })
    expect(reply).not.toHaveBeenCalled()
    finish({ status: 'submitted', values: { notes: 'private' } })
    await waitFor(() => expect(reply).toHaveBeenCalledWith({ type: 'widget-composer-result', id: 'own', outcome: { status: 'submitted', values: { notes: 'private' } } }, '*'))
    window.dispatchEvent(new MessageEvent('message', { source: frame, data: { ...payload, id: 'reset' } }))
    window.dispatchEvent(new MessageEvent('message', { source: frame, data: { type: 'widget-ready' } }))
    expect(reply).toHaveBeenCalledWith({ type: 'widget-composer-result', id: 'reset', outcome: { status: 'cancelled', reason: 'owner_disposed' } }, '*')
    const count = reply.mock.calls.length
    finish({ status: 'submitted', values: { notes: 'late' } })
    await Promise.resolve()
    expect(reply).toHaveBeenCalledTimes(count)
  })
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
    expect(srcdoc).toContain('window.requestInput')
  })

  it('accepts input requests only from its own iframe and replies without exposing answers', async () => {
    const onRequestInput = vi.fn().mockResolvedValue(undefined)
    const { container } = render(<WidgetBlock data={widget()} onRequestInput={onRequestInput} />)
    const frame = container.querySelector('iframe')!.contentWindow!
    const reply = vi.spyOn(frame, 'postMessage')
    const spec = { title: 'Notes', requestedSchema: { type: 'object', properties: { notes: { type: 'string' } } } }
    window.dispatchEvent(new MessageEvent('message', { source: window, data: { type: 'widget-requestInput', requestId: 'foreign', spec } }))
    expect(onRequestInput).not.toHaveBeenCalled()
    window.dispatchEvent(new MessageEvent('message', { source: frame, data: { type: 'widget-requestInput', requestId: 'own', spec } }))
    await waitFor(() => expect(reply).toHaveBeenCalledWith({ type: 'widget-input-result', requestId: 'own' }, '*'))
    expect(onRequestInput).toHaveBeenCalledExactlyOnceWith(spec)
  })

  it('reports host admission failures to the requesting iframe', async () => {
    const { container } = render(<WidgetBlock data={widget()} onRequestInput={async () => { throw new Error('Unsupported schema') }} />)
    const frame = container.querySelector('iframe')!.contentWindow!
    const reply = vi.spyOn(frame, 'postMessage')
    window.dispatchEvent(new MessageEvent('message', { source: frame, data: { type: 'widget-requestInput', requestId: 'bad', spec: {} } }))
    await waitFor(() => expect(reply).toHaveBeenCalledWith({ type: 'widget-input-result', requestId: 'bad', error: 'Unsupported schema' }, '*'))
  })
})
