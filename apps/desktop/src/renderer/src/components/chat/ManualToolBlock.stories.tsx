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
      toolName="mcp__superone__read_manual"
      input={JSON.stringify(input)}
      status={opts.status ?? 'complete'}
      result={opts.result}
      isError={opts.isError}
    />
  )
}

const meta: Meta = {
  title: 'Tool UI/SuperOne MCP/Manual',
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj

export const Gallery: Story = {
  name: 'Gallery',
  render: () => (
    <StoryShell>
      <Section title="read_manual">
        {block({ domain: 'widget', topic: 'overview' }, { status: 'streaming' })}
        {block({ domain: 'widget', topic: 'overview' }, { result: 'Loaded widget guidelines' })}
        {block({ domain: 'product', topic: 'debug' }, { result: JSON.stringify({ status: 'ok', topic: 'debug' }) })}
        {block(
          { domain: 'missing', topic: 'unknown' },
          { isError: true, result: JSON.stringify({ status: 'error', message: 'Unknown manual topic' }) },
        )}
      </Section>
    </StoryShell>
  ),
}

export const ReadManual: Story = {
  name: 'read_manual',
  render: () => (
    <StoryShell>
      <Section title="read_manual">
        {block({ domain: 'miniapp', topic: 'manifest' })}
        {block({ domain: 'miniapp', topic: 'manifest' }, { status: 'streaming' })}
        {block({ domain: 'widget', topic: 'overview' }, { result: JSON.stringify({ status: 'ok' }) })}
      </Section>
    </StoryShell>
  ),
}
