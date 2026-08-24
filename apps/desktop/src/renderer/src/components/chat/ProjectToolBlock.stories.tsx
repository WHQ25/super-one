import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { encode as toonEncode } from '@toon-format/toon'
import {
  SessionArchiveToolBlock,
  type SessionArchiveToolName,
} from './SessionArchiveToolBlock'

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
  params: Record<string, unknown>,
  opts: { status?: 'streaming' | 'complete'; result?: string; isError?: boolean } = {},
) {
  return (
    <SessionArchiveToolBlock
      toolName={'project_list' satisfies SessionArchiveToolName}
      params={params}
      result={opts.result}
      isStreaming={opts.status === 'streaming'}
      isError={opts.isError}
    />
  )
}

const PROJECTS = [
  {
    id: 'proj-aaaaaaaa-1111-4000-8000-aaaaaaaaaaaa',
    name: 'super-one',
    path: '/Users/me/Developer/Projects/super-one',
    lastActiveAt: '2026-08-10T12:00:00.000Z',
    isCurrent: true,
  },
  {
    id: 'proj-bbbbbbbb-2222-4000-8000-bbbbbbbbbbbb',
    name: 'other-app',
    path: '/Users/me/Developer/Projects/other-app',
    lastActiveAt: '2026-07-01T09:00:00.000Z',
  },
]

const PROJECT_LIST_RESULT = toonEncode({
  offset: 0,
  limit: 50,
  count: PROJECTS.length,
  total: PROJECTS.length,
  projects: PROJECTS,
})

const meta: Meta = {
  title: 'Tool UI/SuperOne MCP/Project',
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj

export const Gallery: Story = {
  name: 'Gallery',
  render: () => (
    <StoryShell>
      <Section title="project_list">
        {block({}, { status: 'streaming' })}
        {block({}, { result: PROJECT_LIST_RESULT })}
        {block({ query: 'other' }, { result: PROJECT_LIST_RESULT })}
        {block({}, {
          isError: true,
          result: JSON.stringify({ status: 'error', message: 'Failed to read the project archive.' }),
        })}
      </Section>
    </StoryShell>
  ),
}

export const ProjectList: Story = {
  name: 'project_list',
  render: () => (
    <StoryShell>
      <Section title="project_list">
        {block({}, { status: 'streaming' })}
        {block({}, { result: PROJECT_LIST_RESULT })}
      </Section>
    </StoryShell>
  ),
}
