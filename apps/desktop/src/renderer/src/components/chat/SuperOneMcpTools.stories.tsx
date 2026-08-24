import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { MINIAPP_LIST_BARE_NAME } from '@superone/shared/superone-host-owned-tools'
import { ToolBlock } from './ToolBlock'

const HIDDEN_TOOLS = new Set([
  'session_rename',
  'session_tag_list',
  'session_collab_list_agents',
  MINIAPP_LIST_BARE_NAME,
])

function StoryShell({ children, width = 760 }: { children: ReactNode; width?: number }) {
  return (
    <div className="@container space-y-5" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

function Note({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>
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

function q(tool: string): string {
  return `mcp__superone__${tool}`
}

function Row({
  tool,
  input,
  status = 'complete',
  result,
  isError,
}: {
  tool: string
  input?: Record<string, unknown>
  status?: 'streaming' | 'complete'
  result?: string
  isError?: boolean
}) {
  return (
    <ToolBlock
      toolName={q(tool)}
      input={JSON.stringify(input ?? {})}
      status={status}
      result={result}
      isError={isError}
      elapsedSeconds={status === 'streaming' ? 2 : undefined}
    />
  )
}

const meta: Meta = {
  title: 'Tool UI/SuperOne MCP/Meta',
  parameters: { layout: 'padded' },
}

export default meta

type Story = StoryObj

export const Hidden: Story = {
  name: 'Hidden',
  render: () => (
    <StoryShell>
      <Note>
        These tools are hidden in chat via `isAlwaysHiddenToolBlock` and should render an
        empty row shell.
      </Note>
      {[...HIDDEN_TOOLS].map((tool) => (
        <Section key={tool} title={tool}>
          <Row tool={tool} input={{ title: 'x' }} result="{}" />
        </Section>
      ))}
    </StoryShell>
  ),
}

export const ErrorAndDenied: Story = {
  name: 'Error & denied',
  render: () => (
    <StoryShell>
      <Note>Shared denial / failure patterns for quick regression checks.</Note>
      <Section title="Denied">
        <Row tool="session_tag" input={{ add: ['tool-ui'] }} result="[denied] User denied permission" isError />
        <Row tool="config_apply" input={{ changes: [{ key: 'theme', value: 'dark' }] }} result="[denied] User denied permission" isError />
      </Section>
      <Section title="Error">
        <Row
          tool="media_generate_video"
          input={{ prompt: 'slow camera push on a city street at dusk' }}
          result={JSON.stringify({ status: 'error', message: 'provider returned 500' })}
          isError
        />
        <Row
          tool="miniapp_dev_register"
          input={{ directory: '/tmp/broken', name: 'Broken' }}
          result={JSON.stringify({ status: 'error', message: 'manifest.json not found' })}
          isError
        />
      </Section>
    </StoryShell>
  ),
}
