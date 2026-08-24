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
  tool: 'session_rename' | 'session_tag' | 'session_tag_list',
  input: Record<string, unknown>,
  opts: { status?: 'streaming' | 'complete'; result?: string; isError?: boolean } = {},
) {
  return (
    <ToolBlock
      toolName={`mcp__superone__${tool}`}
      input={JSON.stringify(input)}
      status={opts.status ?? 'complete'}
      result={opts.result}
      isError={opts.isError}
    />
  )
}

const meta: Meta = {
  title: 'Tool UI/SuperOne MCP/Session',
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj

export const SessionRename: Story = {
  name: 'session_rename',
  render: () => (
    <StoryShell>
      <Section title="session_rename">
        {block('session_rename', { title: 'Tool UI grouping' }, { status: 'streaming' })}
        {block('session_rename', { title: 'Tool UI grouping' }, { result: JSON.stringify({ status: 'ok' }) })}
      </Section>
    </StoryShell>
  ),
}

export const SessionTag: Story = {
  name: 'session_tag',
  render: () => (
    <StoryShell>
      <Section title="session_tag">
        {block('session_tag', { add: ['tool-ui'] }, { status: 'streaming' })}
        {block('session_tag', { remove: ['old'] }, { result: JSON.stringify({ action: 'remove', removed: ['old'] }) })}
        {block('session_tag', { set: ['storybook'] }, { result: '[denied] User denied permission', isError: true })}
      </Section>
    </StoryShell>
  ),
}

export const SessionTagList: Story = {
  name: 'session_tag_list',
  render: () => (
    <StoryShell>
      <Section title="session_tag_list">
        {block('session_tag_list', {}, { status: 'streaming' })}
        {block('session_tag_list', {}, { result: JSON.stringify({ tags: ['storybook', 'tool-ui'] }) })}
      </Section>
    </StoryShell>
  ),
}
