import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ReactNode } from 'react'
import { ToolBlock } from './ToolBlock'
import { useMiniAppStore } from '@/stores/miniapp'
import type { MiniAppEntry } from '@superone/shared/miniapp-types'

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

const APP: MiniAppEntry = {
  id: 'crm-tools',
  installDir: '/Users/me/.superone/apps/crm-tools',
  manifest: {
    appId: 'crm-tools',
    name: 'CRM Tools',
    main: 'node.js',
    version: '0.4.0',
    tools: [
      {
        name: 'find_contact',
        description: 'Look up a contact by name or email.',
        displayName: 'Find contact',
        runningText: 'Searching contacts',
        inputSummaryField: 'query',
        resultSummaryField: 'name',
        showResult: true,
        inputSchema: {},
      },
      {
        name: 'add_note',
        description: 'Append a note to a contact record.',
        displayName: 'Add note',
        runningText: 'Saving note',
        inputSummaryField: 'contactId',
        showResult: false,
        inputSchema: {},
      },
    ],
  },
}

const SETUP_INPUT = {
  name: 'palette-picker',
  directory: '/Users/me/projects/palette-picker',
  description: 'A small mini-app that picks colors from an image.',
}

function block(toolName: string, input: Record<string, unknown>, status: 'streaming' | 'complete' = 'complete', result?: string) {
  return (
    <ToolBlock toolName={toolName} input={JSON.stringify(input)} status={status} result={result} elapsedSeconds={status === 'streaming' ? 1 : undefined} />
  )
}

function SeedApps({ children }: { children: ReactNode }) {
  useState(() => {
    useMiniAppStore.setState({ apps: [APP], loaded: true })
    return null
  })
  return <>{children}</>
}

const meta: Meta<typeof ToolBlock> = {
  title: 'Tool UI/SuperOne MCP/Miniapp',
  component: ToolBlock,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => <SeedApps><StoryShell><Story /></StoryShell></SeedApps>,
  ],
}

export default meta
type Story = StoryObj<typeof ToolBlock>

export const Gallery: Story = {
  name: 'Gallery',
  render: () => (
    <StoryShell width={760}>
      <Note>SuperOne MCP mini-app calls and development tools by variant and state (streaming / complete / fallback).</Note>
      <Section title="Known app calls">
        {block('mcp__superone__crm__find_contact', { query: 'alice@example.com' }, 'streaming')}
        {block('mcp__superone__crm__find_contact', { query: 'alice@example.com' }, 'complete', JSON.stringify({ id: 'c-42', name: 'Alice Wong', company: 'Acme Co.', email: 'alice@example.com' }))}
      </Section>
      <Section title="Action tools">
        {block('mcp__superone__crm__add_note', { contactId: 'c-42', body: 'Met at conference, follow up next week.' }, 'complete', JSON.stringify({ ok: true }))}
        {block('mcp__superone__notinstalled__do_thing', { x: 1 }, 'complete', JSON.stringify({ note: 'plug icon fallback when app not found' }))}
      </Section>
      <Section title="miniapp_dev_setup">
        {block('mcp__superone__miniapp_dev_setup', SETUP_INPUT, 'streaming')}
        {block('mcp__superone__miniapp_dev_setup', SETUP_INPUT)}
        {block('mcp__superone__miniapp_dev_setup', SETUP_INPUT, 'complete', JSON.stringify({
          status: 'ok',
          appId: 'palette-picker',
        }))}
        {block('mcp__superone__miniapp_dev_setup', SETUP_INPUT, 'complete', JSON.stringify({
          status: 'error',
          message:
            'Directory already contains a manifest.json — refusing to overwrite. Delete the existing app first or pick a different directory.',
        }))}
      </Section>
    </StoryShell>
  ),
}

export const MiniappList: Story = {
  name: 'miniapp_list',
  render: () => (
    <StoryShell>
      <Note>The fixed mini-app catalog is hidden from the transcript after it feeds tool discovery.</Note>
      {block('mcp__superone__miniapp_list', {}, 'complete', JSON.stringify({ apps: [APP.manifest] }))}
    </StoryShell>
  ),
}

export const MiniappCall: Story = {
  name: 'miniapp_call',
  render: () => (
    <StoryShell>
      <Section title="miniapp_call">
        {block('mcp__superone__miniapp_call', {
          appId: APP.id,
          tool: 'find_contact',
          input: { query: 'alice@example.com' },
        }, 'streaming')}
        {block('mcp__superone__miniapp_call', {
          appId: APP.id,
          tool: 'find_contact',
          input: { query: 'alice@example.com' },
        }, 'complete', JSON.stringify({ id: 'c-42', name: 'Alice Wong' }))}
      </Section>
    </StoryShell>
  ),
}
