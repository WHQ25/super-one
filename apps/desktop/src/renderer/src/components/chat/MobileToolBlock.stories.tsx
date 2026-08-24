import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { ToolBlock } from './ToolBlock'

function StoryShell({ children, width = 680 }: { children: ReactNode; width?: number }) {
  return (
    <div className="@container space-y-4" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="space-y-1">{children}</div>
    </section>
  )
}

function block(
  input: Record<string, unknown>,
  opts: { status?: 'streaming' | 'complete'; result?: string; isError?: boolean } = {},
) {
  return (
    <ToolBlock
      toolName="mcp__superone__mobile_share_file"
      input={JSON.stringify(input)}
      status={opts.status ?? 'complete'}
      result={opts.result}
      isError={opts.isError}
    />
  )
}

const meta: Meta = {
  title: 'Tool UI/SuperOne MCP/Mobile',
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj

export const Gallery: Story = {
  name: 'Gallery',
  render: () => (
    <StoryShell>
      <Section title="mobile_share_file">
        {block({ path: '/tmp/notes.pdf' }, { status: 'streaming' })}
        {block({ path: '/tmp/notes.pdf' }, { result: JSON.stringify({ ok: true, path: '/tmp/notes.pdf' }) })}
        {block({ path: '/tmp/missing.pdf' }, {
          isError: true,
          result: JSON.stringify({ ok: false, message: 'File does not exist' }),
        })}
      </Section>
    </StoryShell>
  ),
}

export const MobileShareFile: Story = {
  name: 'mobile_share_file',
  render: () => (
    <StoryShell>
      <Section title="mobile_share_file">
        {block({ path: '/tmp/notes.pdf' }, { status: 'streaming' })}
        {block({ path: '/tmp/notes.pdf' }, { result: JSON.stringify({ ok: true, path: '/tmp/notes.pdf' }) })}
      </Section>
    </StoryShell>
  ),
}
