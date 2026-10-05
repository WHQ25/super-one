/** @vitest-environment jsdom */

import { fireEvent, render, waitFor } from '@testing-library/react'
import { act } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PortableToolRow } from '@superone/chat-view/PortableToolRow'
import { installHostBridge } from '@superone/chat-view/bridge'
import { TurnMessageIdContext } from '@superone/chat-view/portable-turn-context'
import { buildWidgetSrcdoc, widgetThemeVars } from '@superone/shared/generative-ui/widget-srcdoc'

/**
 * `widget_show` reaches the phone whole — `shouldKeepRemoteToolInput` keeps the
 * `widget_code`, and the settled result is exempt from the 200-char tool-result
 * truncation — but only the `@native/*` templates ever had a renderer. A code
 * widget parsed to `null` there and fell through to a bare tool row, which is why
 * a widget looked like it "did not render" on mobile.
 */
function widgetResult(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    title: 'mobile_composer_options',
    widget_code: '<div id="hello">Hello from the widget</div>',
    width: 800,
    height: 420,
    isSVG: false,
    ...overrides,
  })
}

function renderWidgetRow(props: { result?: string; status?: 'streaming' | 'complete'; isError?: boolean } = {}) {
  return render(
    <PortableToolRow
      toolName="mcp__superone__widget_show"
      toolUseId="widget-1"
      input={widgetResult()}
      status={props.status ?? 'complete'}
      isError={props.isError}
      result={'result' in props ? props.result : widgetResult()}
    />,
  )
}

describe('code widget on the phone', () => {
  it('keeps composer completion separate from the short opening receipt', async () => {
    vi.useFakeTimers()
    const disconnect = installHostBridge(() => {}), host = vi.spyOn(window.parent, 'postMessage')
    try {
      const { container } = render(<TurnMessageIdContext.Provider value="assistant-1"><PortableToolRow
        toolName="mcp__superone__widget_show" toolUseId="widget-1" input={widgetResult()} result={widgetResult()} status="complete"
      /></TurnMessageIdContext.Provider>)
      const frame = container.querySelector('iframe')!.contentWindow!, reply = vi.spyOn(frame, 'postMessage')
      host.mockClear()
      const spec = { title: 'Notes', requestedSchema: { type: 'object', properties: { notes: { type: 'string' } } } }
      act(() => window.dispatchEvent(new MessageEvent('message', { source: frame, data: { type: 'widget-composer-open', id: 'call', spec } })))
      const native = host.mock.calls.find(([message]) => message?.action === 'composerOpen')![0]
      expect(native.payload).toEqual({ viewId: expect.any(String), localId: 'call', messageId: 'assistant-1', output: 'caller', spec })
      act(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'nativeActionResult', requestId: native.requestId, result: { ok: true, requestId: 'form' } } })))
      await vi.advanceTimersByTimeAsync(180_000)
      expect(reply.mock.calls.filter(([message]) => message?.type === 'widget-composer-result')).toEqual([])
      act(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'composerSettled', viewId: 'foreign', localId: 'call', outcome: { status: 'submitted', values: { notes: 'wrong' } } } })))
      expect(reply.mock.calls.filter(([message]) => message?.type === 'widget-composer-result')).toEqual([])
      act(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'composerSettled', viewId: native.payload.viewId, localId: 'call', outcome: { status: 'submitted', values: { notes: 'answer' } } } })))
      await Promise.resolve()
      expect(reply).toHaveBeenCalledWith({ type: 'widget-composer-result', id: 'call', outcome: { status: 'submitted', values: { notes: 'answer' } } }, '*')
    } finally { disconnect(); host.mockRestore(); vi.useRealTimers() }
  })
  it.each([undefined, 'Host refused this form'])('opens forms through the native bridge and replies only to its own iframe (%s)', async error => {
    const disconnect = installHostBridge(() => {})
    const host = vi.spyOn(window.parent, 'postMessage')
    try {
      const { container } = render(<TurnMessageIdContext.Provider value="assistant-1"><PortableToolRow
        toolName="mcp__superone__widget_show" toolUseId="widget-1" input={widgetResult()} result={widgetResult()} status="complete"
      /></TurnMessageIdContext.Provider>)
      const frame = container.querySelector('iframe')!.contentWindow!
      const reply = vi.spyOn(frame, 'postMessage')
      host.mockClear()
      const spec = { title: 'Notes', requestedSchema: { type: 'object', properties: { notes: { type: 'string' } } } }
      window.dispatchEvent(new MessageEvent('message', { source: window, data: { type: 'widget-requestInput', requestId: 'foreign', spec } }))
      expect(host).not.toHaveBeenCalled()
      window.dispatchEvent(new MessageEvent('message', { source: frame, data: { type: 'widget-requestInput', requestId: 'own', spec } }))
      await waitFor(() => expect(host).toHaveBeenCalledWith(expect.objectContaining({ type: 'requestNative', action: 'requestInput', payload: { messageId: 'assistant-1', spec } }), '*'))
      const request = host.mock.calls.find(([message]) => message?.action === 'requestInput')![0]
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'nativeActionResult', requestId: request.requestId, ...(error ? { error } : { result: { ok: true } }) } }))
      await waitFor(() => expect(reply).toHaveBeenCalledWith({ type: 'widget-input-result', requestId: 'own', ...(error ? { error } : {}) }, '*'))
    } finally {
      disconnect()
      host.mockRestore()
    }
  })

  it('mounts the widget in a sandboxed frame instead of a plain tool row', () => {
    const { container } = renderWidgetRow()
    const frame = container.querySelector('iframe')

    expect(frame).not.toBeNull()
    expect(frame!.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame!.getAttribute('title')).toBe('mobile composer options')
  })

  it('ships the agent code and the host bridge into the frame', () => {
    const { container } = renderWidgetRow()
    const srcdoc = container.querySelector('iframe')!.getAttribute('srcdoc')!

    expect(srcdoc).toContain('Hello from the widget')
    expect(srcdoc).toContain('window.sendPrompt')
    expect(srcdoc).toContain('widget-resize')
  })

  it('forwards non-interactive drags so the transcript still scrolls under the widget', () => {
    const { container } = renderWidgetRow()
    const srcdoc = container.querySelector('iframe')!.getAttribute('srcdoc')!

    // Desktop widgets scroll the page through the wheel bridge; a phone has no wheel,
    // and without this a full-height widget is a scroll trap.
    expect(srcdoc).toContain('widget-touch-scroll')
    expect(srcdoc).toContain('touchmove')
  })

  it('leaves touch forwarding out of the desktop document', () => {
    expect(buildWidgetSrcdoc('<p>x</p>', false)).not.toContain('widget-touch-scroll')
  })

  it('starts at the requested height before the frame reports its own', () => {
    const { container } = renderWidgetRow()
    expect(container.querySelector('iframe')!.style.height).toBe('420px')
  })

  it('shows the desktop generating row while the call is still streaming', () => {
    // The phone gets no partial input, so it stops at the desktop's first stage
    // rather than falling back to the generic `superone · widget show` row.
    const { container } = renderWidgetRow({ status: 'streaming', result: undefined })
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.textContent).toContain('Generating widget…')
    expect(container.textContent).not.toContain('widget show')
  })

  it('keeps the ordinary row for a failed call, which is the only one that says why', () => {
    const { container } = renderWidgetRow({ isError: true })
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('names the widget in a header the phone can actually see', () => {
    // The desktop reveals the title and its actions on hover. A phone has no hover, so
    // the same treatment would hide them for good.
    const { container } = renderWidgetRow()

    expect(container.textContent).toContain('mobile composer options')
    expect(container.querySelector('[aria-label="Save as template"]')).not.toBeNull()
  })

  it('calls the update wording for a widget that is already a template', () => {
    const { container } = render(
      <PortableToolRow
        toolName="mcp__superone__widget_show"
        toolUseId="widget-tpl"
        input="{}"
        status="complete"
        result={widgetResult({ templateId: 'composer-options' })}
      />,
    )
    expect(container.querySelector('[aria-label="Update template"]')).not.toBeNull()
  })

  it('opens the save form from the header and closes it again', () => {
    const { container } = renderWidgetRow()
    const save = container.querySelector<HTMLButtonElement>('[aria-label="Save as template"]')!

    expect(container.querySelector('[aria-label="Template name"]')).toBeNull()
    fireEvent.click(save)
    expect(container.querySelector('[aria-label="Template name"]')).not.toBeNull()
    fireEvent.click(container.querySelector<HTMLButtonElement>('[aria-label="Save as template"]')!)
    expect(container.querySelector('[aria-label="Template name"]')).toBeNull()
  })

  it('seeds the form with the widget name, underscores read as spaces', () => {
    const { container } = renderWidgetRow()
    fireEvent.click(container.querySelector<HTMLButtonElement>('[aria-label="Save as template"]')!)

    const name = container.querySelector<HTMLInputElement>('[aria-label="Template name"]')!
    expect(name.value).toBe('mobile composer options')
  })

  it('maps the host palette onto the widget token contract', () => {
    // The failure this guards is silent: `SVG_STYLES` ships a warm-neutral palette, so a
    // widget that follows the manual paints a cream card onto a cool transcript and simply
    // looks like a slab someone pasted in.
    const vars = widgetThemeVars((token) => ({
      '--card': 'oklch(0.205 0 0)',
      '--muted': 'oklch(0.269 0 0)',
      '--background': 'oklch(0.145 0 0)',
      '--foreground': 'oklch(0.985 0 0)',
      '--border': 'oklch(0.269 0 0)',
    } as Record<string, string>)[token] ?? '')

    expect(vars['--color-background-primary']).toBe('oklch(0.205 0 0)')
    expect(vars['--color-background-secondary']).toBe('oklch(0.269 0 0)')
    // Not the page colour: the widget body is transparent, so a fill painted in the
    // transcript's own background would simply not be there.
    expect(vars['--color-background-tertiary']).toBe('oklch(0.205 0 0)')
    expect(vars['--color-text-primary']).toBe('oklch(0.985 0 0)')
    // A token the host cannot resolve keeps the widget's built-in default rather than
    // being overridden with an empty string.
    expect(vars).not.toHaveProperty('--color-text-secondary')
    // The dark `--border` equals `--muted`, so a mapped border would vanish on the
    // secondary surface widgets draw lines on; the built-in translucent ink stays.
    expect(vars).not.toHaveProperty('--color-border-tertiary')
  })

  it('applies host colours inside the frame rather than only toggling dark', () => {
    expect(buildWidgetSrcdoc('<p>x</p>', false)).toContain('d.vars')
  })

  it('declares the transcript colour scheme so the frame stays see-through', () => {
    // Not cosmetic: a frame whose used colour scheme differs from its parent's stops
    // being composited transparently and gets an opaque canvas painted underneath, so
    // a transparent widget body ended up on a white slab in the phone's dark chat.
    const srcdoc = renderWidgetRow().container.querySelector('iframe')!.getAttribute('srcdoc')!

    expect(srcdoc).toContain('html{color-scheme:dark}')
  })

  it('leaves the scheme undeclared for a host that declares none', () => {
    // The desktop transcript never sets `color-scheme`, so it is light — and so is an
    // undeclared widget. Stamping one there would create the mismatch, not avoid it.
    expect(buildWidgetSrcdoc('<p>x</p>', false)).not.toContain('color-scheme')
  })

  it('carries the scheme over the theme bridge, not only in the initial document', () => {
    // The srcdoc is built once, so a theme switch after the widget is on screen can
    // only reach it through the message handler.
    expect(buildWidgetSrcdoc('<p>x</p>', false)).toContain('d.colorScheme')
  })

  it('still renders a native gallery template rather than treating it as code', () => {
    const { container } = render(
      <PortableToolRow
        toolName="mcp__superone__widget_show"
        toolUseId="widget-2"
        input="{}"
        status="complete"
        result={JSON.stringify({
          kind: 'native',
          nativeType: 'image-gallery',
          title: 'renders',
          images: [{ savedPath: '/tmp/one.png' }],
        })}
      />,
    )
    expect(container.querySelector('iframe')).toBeNull()
  })
})
