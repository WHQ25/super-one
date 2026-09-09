import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import { sanitizeRemoteToolInput } from '@superone/shared/remote-tool-input'
import { PortableMessage } from './PortableMessage'

/**
 * SuperOne's own tools and callouts as a whole turn on the phone, at phone width.
 *
 * These three used to render as nothing, a bare row, and an unlabelled `plug` row
 * respectively, so the value of a story here is the composition: it shows what a turn
 * that uses SuperOne's own surface actually looks like end to end, which is the thing
 * that was never inspectable before.
 */
function tool(toolName: string, params: Record<string, unknown>, result: string): ContentBlock[] {
  const full = `mcp__superone__${toolName}`
  return [
    {
      type: 'tool_use',
      toolName: full,
      toolUseId: toolName,
      status: 'complete',
      input: sanitizeRemoteToolInput(full, JSON.stringify(params)),
    } as ContentBlock,
    { type: 'tool_result', toolUseId: toolName, summary: result } as ContentBlock,
  ]
}

const WIDGET_RESULT = JSON.stringify({
  title: 'composer_layout_options',
  widget_code: `<div style="padding:14px;font:13px system-ui;color:var(--color-text-primary)">
    <div style="font-weight:500;margin-bottom:8px">Input width by layout</div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span style="width:64px">Current</span><div style="flex:1;height:6px;border-radius:3px;background:var(--color-background-tertiary)"><div style="width:74%;height:100%;border-radius:3px;background:var(--color-text-info)"></div></div></div>
    <div style="display:flex;align-items:center;gap:8px"><span style="width:64px">Toolbar</span><div style="flex:1;height:6px;border-radius:3px;background:var(--color-background-tertiary)"><div style="width:100%;height:100%;border-radius:3px;background:var(--color-text-info)"></div></div></div>
  </div>`,
  width: 800,
  height: 130,
  isSVG: false,
})

function turn(content: ContentBlock[]): ChatMessage {
  return {
    id: 'superone-turn',
    role: 'assistant',
    providerId: 'claude',
    createdAt: '2026-09-09T00:00:00Z',
    status: 'complete',
    content,
  } as ChatMessage
}

function SuperoneTurn({ content }: { content: ContentBlock[] }) {
  return (
    <div className="w-[390px] p-4">
      <PortableMessage
        message={turn(content)}
        scheme="dark"
        pendingPermission={null}
        isLastAssistant
        sessionStreaming={false}
      />
    </div>
  )
}

const meta = {
  title: 'Chat/SuperOne/Portable turn',
  component: SuperoneTurn,
} satisfies Meta<typeof SuperoneTurn>

export default meta
type Story = StoryObj<typeof meta>

export const Everything: Story = {
  name: 'Full turn · rows, insight, widget',
  args: {
    content: [
      { type: 'text', text: 'Checked the settings and the manual first.' } as ContentBlock,
      ...tool('config_read', { domain: 'appearance' }, JSON.stringify({ label: 'Appearance' })),
      ...tool('read_manual', { domain: 'widget', topic: 'mockup' }, 'ok'),
      {
        type: 'insight',
        title: 'Insight',
        content: '- The projection ships a typed block.\n- The renderer had no case for it.',
      } as ContentBlock,
      ...tool('widget_show', { title: 'composer_layout_options' }, WIDGET_RESULT),
      { type: 'text', text: 'Both layouts widen the input; the toolbar one widens it most.' } as ContentBlock,
    ],
  },
}

export const MarkdownTable: Story = {
  name: 'Markdown table · at phone width',
  args: {
    content: [
      { type: 'text', text: [
        'Where each tool renders:',
        '',
        '| Tool | Desktop | Mobile |',
        '| --- | --- | --- |',
        '| `widget_show` | WidgetBlock | portable frame |',
        '| `config_read` | compact row | compact row |',
        '| `read_manual` | compact row | compact row |',
        '',
        'Both surfaces share the descriptor table.',
      ].join('\n') } as ContentBlock,
    ],
  },
}

export const WideMarkdownTable: Story = {
  name: 'Markdown table · more columns than the screen fits',
  args: {
    content: [
      { type: 'text', text: [
        '| Tool | Desktop presenter | Mobile presenter | Projection fields | Notes |',
        '| --- | --- | --- | --- | --- |',
        '| `widget_show` | WidgetBlock | PortableWidgetBlock | widget_code kept whole | sandboxed iframe |',
        '| `session_tag` | compact row | compact row | add / remove / set | ids emptied |',
      ].join('\n') } as ContentBlock,
    ],
  },
}

export const ToolRowsOnly: Story = {
  name: 'Compact rows · four SuperOne tools in a row',
  args: {
    content: [
      ...tool('config_read', {}, 'ok'),
      ...tool('read_manual', { domain: 'product', topic: 'automation' }, 'ok'),
      ...tool('session_tag', { add: ['mobile-ui', 'composer'] }, 'ok'),
      ...tool('widget_list_templates', {}, 'ok'),
    ],
  },
}

export const InsightOnly: Story = {
  name: 'Insight · between two paragraphs',
  args: {
    content: [
      { type: 'text', text: 'Here is what I found.' } as ContentBlock,
      {
        type: 'insight',
        title: 'Why the phone differs',
        content: 'Desktop splits the `★ … ───` markers at render time; the phone receives them already split.',
      } as ContentBlock,
      { type: 'text', text: 'Fixing it next.' } as ContentBlock,
    ],
  },
}

export const WidgetOnly: Story = {
  name: 'Widget · sandboxed frame at phone width',
  args: { content: tool('widget_show', { title: 'composer_layout_options' }, WIDGET_RESULT) },
}

export const FailedWidget: Story = {
  name: 'Widget failed · ordinary row carries the reason',
  args: {
    content: [
      {
        type: 'tool_use',
        toolName: 'mcp__superone__widget_show',
        toolUseId: 'widget-err',
        status: 'complete',
        isError: true,
        input: '{}',
      } as ContentBlock,
      { type: 'tool_result', toolUseId: 'widget-err', summary: 'widget_code is required', isError: true } as ContentBlock,
    ],
  },
}
