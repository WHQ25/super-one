import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { WidgetBlock } from './WidgetBlock'
import { ToolBlock } from './ToolBlock'
import { SETTINGS_MOCKUP_WIDGET, SHORT_RESULT_WIDGET_CALL } from '@superone/chat-view/fixtures/widget-mockup'

function StoryShell({ children, width = 720 }: { children: ReactNode; width?: number }) {
  return (
    <div className="@container" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="space-y-1">{children}</div>
    </section>
  )
}

function Note({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>
}

function block(data: { title: string; widget_code: string; width: number; height: number; isSVG: boolean }, streaming = false) {
  return <WidgetBlock data={data} streaming={streaming} />
}

function mcpBlock(
  tool: 'widget_list_templates' | 'widget_show',
  input: Record<string, unknown> | string,
  result?: string,
  status: 'streaming' | 'complete' = 'complete',
  isError?: boolean,
) {
  return (
    <ToolBlock
      toolName={`mcp__superone__${tool}`}
      input={typeof input === 'string' ? input : JSON.stringify(input)}
      status={status}
      result={result}
      isError={isError}
    />
  )
}

const meta: Meta<typeof WidgetBlock> = {
  title: 'Tool UI/SuperOne MCP/Widget',
  component: WidgetBlock,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <StoryShell width={820}><Story /></StoryShell>],
}

export default meta
type Story = StoryObj<typeof WidgetBlock>

const SVG_GAUGE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#fcd9b8"/>
      <stop offset="1" stop-color="#f0a062"/>
    </linearGradient>
  </defs>
  <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="#eee" stroke-width="14" stroke-linecap="round"/>
  <path d="M20 100 A80 80 0 0 1 140 32" fill="none" stroke="url(#g)" stroke-width="14" stroke-linecap="round"/>
  <text x="100" y="80" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="22" font-weight="600" fill="#333">72%</text>
  <text x="100" y="105" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="11" fill="#888">storybook coverage</text>
</svg>`

const HTML_CARD = `<!doctype html>
<html><head><meta charset="utf-8"/><style>
  body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; padding: 16px; background: #fff8f0; color: #1a1a1a; }
  h1 { margin: 0 0 8px 0; font-size: 18px; }
  .row { display: flex; gap: 12px; margin-top: 12px; }
  .stat { flex: 1; padding: 12px; background: #fff; border-radius: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
  .label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 0.05em; }
  .value { font-size: 22px; font-weight: 600; margin-top: 4px; }
</style></head><body>
  <h1>Build summary · super-one v0.26.0-alpha</h1>
  <div class="row">
    <div class="stat"><div class="label">macOS DMG</div><div class="value">142 MB</div></div>
    <div class="stat"><div class="label">Windows NSIS</div><div class="value">98 MB</div></div>
    <div class="stat"><div class="label">Linux AppImage</div><div class="value">110 MB</div></div>
  </div>
</body></html>`

export const Gallery: Story = {
  name: 'Gallery',
  render: () => (
    <StoryShell width={780}>
      <Note>SuperOne MCP widget rows should render both SVG and HTML widgets; streaming state should keep layout stable.</Note>
      <Section title="widget_list_templates">
        {mcpBlock('widget_list_templates', {}, JSON.stringify({ templates: [{ id: 'coverage', name: 'Coverage gauge' }] }))}
      </Section>
      <Section title="Widget output">
        {block({
          title: 'storybook_coverage_gauge',
          widget_code: SVG_GAUGE,
          width: 200,
          height: 120,
          isSVG: true,
        })}
        {block({
          title: 'build_summary_card',
          widget_code: HTML_CARD,
          width: 480,
          height: 220,
          isSVG: false,
        })}
        {block({
          title: 'streaming_widget',
          widget_code: SVG_GAUGE,
          width: 200,
          height: 120,
          isSVG: true,
        }, true)}
      </Section>
    </StoryShell>
  ),
}

const HAIRLINE_EDGE = `<div style="border:0.5px solid var(--color-border-primary);border-radius:8px;padding:12px">Full-width panel</div>
<div style="display:flex;justify-content:flex-end;margin-top:12px"><button>Right-aligned action ↗</button></div>`

export const FractionalWidth: Story = {
  name: 'Fractional container width',
  render: () => (
    <div style={{ width: 600.25 }}>
      <Note>The right hairline border and button edge stay visible after the iframe replaces the streaming preview.</Note>
      {block({ title: 'hairline_edge', widget_code: HAIRLINE_EDGE, width: 600, height: 100, isSVG: false })}
    </div>
  ),
}

function mockup(layout: 'fluid' | 'fixed', streaming = false) {
  return <WidgetBlock data={{ title: `settings_mockup_${layout}`, widget_code: SETTINGS_MOCKUP_WIDGET, width: 680, height: 300, isSVG: false, layout }} streaming={streaming} />
}

export const FixedLayout: Story = {
  name: 'Fixed layout',
  render: () => (
    <div className="space-y-6">
      <Note>A fixed widget keeps its 680px composition: rendered as written in a wide transcript, scaled down as a whole in a narrow pane. Fluid reflows instead.</Note>
      <Section title="Wide pane · fixed">
        <div style={{ width: 760 }}>{mockup('fixed')}</div>
      </Section>
      <Section title="Narrow pane · fixed">
        <div style={{ width: 420 }}>{mockup('fixed')}</div>
      </Section>
      <Section title="Narrow pane · fixed, streaming preview">
        <div style={{ width: 420 }}>{mockup('fixed', true)}</div>
      </Section>
      <Section title="Narrow pane · fluid">
        <div style={{ width: 420 }}>{mockup('fluid')}</div>
      </Section>
    </div>
  ),
}

export const WidgetListTemplates: Story = {
  name: 'widget_list_templates',
  render: () => (
    <StoryShell width={780}>
      <Section title="widget_list_templates">
        {mcpBlock('widget_list_templates', {}, undefined, 'streaming')}
        {mcpBlock('widget_list_templates', {}, JSON.stringify({ templates: [{ id: 'coverage', name: 'Coverage gauge' }] }))}
      </Section>
    </StoryShell>
  ),
}

export const WidgetShow: Story = {
  name: 'widget_show',
  render: () => (
    <StoryShell width={780}>
      <Section title="widget_show">
        {block({
          title: 'storybook_coverage_gauge',
          widget_code: SVG_GAUGE,
          width: 200,
          height: 120,
          isSVG: true,
        })}
        {block({
          title: 'streaming_widget',
          widget_code: SVG_GAUGE,
          width: 200,
          height: 120,
          isSVG: true,
        }, true)}
      </Section>
    </StoryShell>
  ),
}

export const ShortResult: Story = {
  name: 'widget_show · short result, drawn from the input',
  render: () => {
    const { input, result } = SHORT_RESULT_WIDGET_CALL
    return (
      <StoryShell width={780}>
        <Note>Claude and Codex calls return only an acknowledgement, so the row draws the widget from the call input, data included. A call interrupted once its input was complete keeps the widget it drew; failed, denied and half-streamed calls keep the ordinary row.</Note>
        <Section title="Streaming · partial input preview">
          {mcpBlock('widget_show', input.slice(0, 150), undefined, 'streaming')}
        </Section>
        <Section title="Input complete · frame mounted before the result">
          {mcpBlock('widget_show', input, undefined, 'streaming')}
        </Section>
        <Section title="Short result">
          {mcpBlock('widget_show', input, result)}
        </Section>
        <Section title="Interrupted after the input completed · the widget stays">
          {mcpBlock('widget_show', input)}
        </Section>
        <Section title="Interrupted while the input streamed · ordinary row">
          {mcpBlock('widget_show', input.slice(0, 150))}
        </Section>
        <Section title="Failed · denied">
          {mcpBlock('widget_show', input, 'widget_show failed.', 'complete', true)}
          {mcpBlock('widget_show', input, '[denied] The user declined this call.', 'complete', true)}
        </Section>
      </StoryShell>
    )
  },
}

export const Collapse: Story = {
  name: 'widget_show · collapsed and expanded, like an MCP App View',
  render: () => (
    <div className="space-y-6">
      <Note>The header stays pinned with the widget glyph before the title. The title or the trailing chevron folds the widget into a tool row and back; the frame stays mounted, so the widget keeps its state.</Note>
      <Section title="Expanded">
        {block({ title: 'storybook_coverage_gauge', widget_code: SVG_GAUGE, width: 200, height: 120, isSVG: true })}
      </Section>
      <Section title="Collapsed">
        <div data-story-collapsed>{block({ title: 'build_summary_card', widget_code: SVG_GAUGE, width: 200, height: 120, isSVG: true })}</div>
      </Section>
      <Section title="Collapsed · long title in a narrow pane">
        <div data-story-collapsed style={{ width: 320 }}>{block({ title: 'mobile_composer_attachment_and_send_button_layout_options', widget_code: SVG_GAUGE, width: 200, height: 120, isSVG: true })}</div>
      </Section>
    </div>
  ),
  play: async ({ canvasElement }) => {
    for (const title of canvasElement.querySelectorAll<HTMLElement>('[data-story-collapsed] [data-embedded-tool-title]')) title.click()
  },
}
