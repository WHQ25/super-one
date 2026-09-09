/** @vitest-environment jsdom */

import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PortableToolRow } from '@superone/chat-view/PortableToolRow'
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

  it('keeps the ordinary row while the call is still streaming', () => {
    const { container } = renderWidgetRow({ status: 'streaming', result: undefined })
    expect(container.querySelector('iframe')).toBeNull()
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
    } as Record<string, string>)[token] ?? '')

    expect(vars['--color-background-primary']).toBe('oklch(0.205 0 0)')
    expect(vars['--color-background-secondary']).toBe('oklch(0.269 0 0)')
    // Not the page colour: the widget body is transparent, so a fill painted in the
    // transcript's own background would simply not be there.
    expect(vars['--color-background-tertiary']).toBe('oklch(0.205 0 0)')
    expect(vars['--color-text-primary']).toBe('oklch(0.985 0 0)')
    // A token the host cannot resolve keeps the widget's built-in default rather than
    // being overridden with an empty string.
    expect(vars).not.toHaveProperty('--color-border-primary')
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
