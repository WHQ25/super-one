import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { WidgetBlock } from './WidgetBlock'

function StoryShell({ children, width = 720 }: { children: ReactNode; width?: number }) {
  return (
    <div className="@container" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

const meta: Meta<typeof WidgetBlock> = {
  title: 'Common/WidgetBlock',
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

export const SvgWidgetComplete: Story = {
  args: {
    data: {
      title: 'storybook_coverage_gauge',
      widget_code: SVG_GAUGE,
      width: 200,
      height: 120,
      isSVG: true,
    },
    streaming: false,
  },
}

export const HtmlWidgetComplete: Story = {
  args: {
    data: {
      title: 'build_summary_card',
      widget_code: HTML_CARD,
      width: 480,
      height: 220,
      isSVG: false,
    },
    streaming: false,
  },
}

export const StreamingShadow: Story = {
  args: {
    data: {
      title: 'streaming_widget',
      widget_code: SVG_GAUGE,
      width: 200,
      height: 120,
      isSVG: true,
    },
    streaming: true,
  },
}
